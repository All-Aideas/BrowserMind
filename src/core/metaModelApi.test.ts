import { describe, expect, it } from "vitest";
import { escalateSession, runDiagnosticSession } from "./engine";
import { ModelHarness } from "./harness";
import { DEFAULT_META_MODEL, META_PROXY_ENDPOINT, MetaModelApiAdapter, parseSparkPatch } from "./metaModelApi";

interface CapturedRequest {
  url: string;
  body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    max_tokens: number;
    response_format?: { type: string };
  };
}

function fakeFetch(content: string | null, init: { status?: number; usage?: object } = {}) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (url: string, request: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(request.body)) });
    if (init.status && init.status >= 400) return new Response("rate limited", { status: init.status });
    const usage = init.usage ?? { prompt_tokens: 200, completion_tokens: 80, completion_tokens_details: { reasoning_tokens: 50 } };
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

function adapterWith(content: string | null, init?: { status?: number; usage?: object }) {
  const fake = fakeFetch(content, init);
  const harness = new ModelHarness();
  return { adapter: new MetaModelApiAdapter({ fetchImpl: fake.fetchImpl, harness }), requests: fake.requests, harness };
}

// Error sin firma conocida: confianza baja, el plan pide nivel 3 (Muse Spark).
const SOURCE = [
  "import pandas as pd",
  'df = pd.DataFrame({"price": [10, 20], "qty": [1, 2]})',
  'total = df["price"] * df["qty"]',
  "result = total.rolling(window=0).mean()",
].join("\n");
const TRACEBACK = 'File "/home/ana/proyecto/report.py", line 4\nValueError: min_periods 1 must be <= window 0';

describe("MetaModelApiAdapter (Muse Spark, nivel 3)", () => {
  it("usa el proxy y el modelo por defecto, y pide structured output", async () => {
    const { adapter, requests } = adapterWith(JSON.stringify({ before: "window=0", after: "window=2", explanation: "ventana válida" }));
    expect(adapter.level).toBe(3);
    expect(adapter.model).toBe(DEFAULT_META_MODEL);
    const session = runDiagnosticSession(SOURCE, TRACEBACK, [adapter]);
    expect(session.escalation).toMatchObject({ level: 3, available: true });

    const escalated = await escalateSession(session, adapter);
    expect(requests[0].url).toBe(META_PROXY_ENDPOINT);
    expect(requests[0].body).toMatchObject({ model: "muse-spark-1.3", max_tokens: 2048, response_format: { type: "json_schema" } });
    expect(escalated.patch).toMatchObject({ origin: "model", before: "window=0", after: "window=2" });
    expect(escalated.metrics).toMatchObject({ calls: 1, generativeTokens: 280 });
    expect(adapter.lastReasoningTokens).toBe(50);
  });

  it("acepta JSON dentro de un bloque ```json y quita prefijos de línea", async () => {
    const parsed = parseSparkPatch('Listo:\n```json\n{"before": "4: total.rolling(window=0)", "after": "total.rolling(window=2)", "explanation": "x"}\n```');
    expect(parsed.before).toBe("total.rolling(window=0)");

    const { adapter } = adapterWith('```json\n{"before": "window=0", "after": "window=2", "explanation": "x"}\n```');
    const escalated = await escalateSession(runDiagnosticSession(SOURCE, TRACEBACK, [adapter]), adapter);
    expect(escalated.patch?.after).toBe("window=2");
  });

  it("propaga un HTTP 429 con el estado y lo registra como fallido", async () => {
    const { adapter, harness } = adapterWith("", { status: 429 });
    await expect(escalateSession(runDiagnosticSession(SOURCE, TRACEBACK, [adapter]), adapter)).rejects.toThrow(/429/);
    expect(harness.totals()).toMatchObject({ calls: 1, failedCalls: 1 });
  });

  it("falla con un mensaje claro si la respuesta viene vacía", async () => {
    const { adapter, harness } = adapterWith(null);
    await expect(escalateSession(runDiagnosticSession(SOURCE, TRACEBACK, [adapter]), adapter)).rejects.toThrow(/no contiene JSON/);
    expect(harness.totals().failedCalls).toBe(1);
  });

  it("escalateSession descarta un fragmento ambiguo", async () => {
    const { adapter } = adapterWith(JSON.stringify({ before: 'df["', after: 'df.loc[:, "', explanation: "x" }));
    const escalated = await escalateSession(runDiagnosticSession(SOURCE, TRACEBACK, [adapter]), adapter);
    expect(escalated.patch).toBeUndefined();
    expect(escalated.modelNote).toMatch(/2 veces.*ambiguo/);
  });

  it("envía sólo el contexto redactado, nunca el resto del script", async () => {
    const { adapter, requests } = adapterWith(JSON.stringify({ before: "", after: "", explanation: "sin cambio" }));
    const filler = Array.from({ length: 20 }, (_, i) => `secret_${i} = "C:\\\\Users\\\\ana\\\\data_${i}.csv"`).join("\n");
    // Sin firma conocida el contexto arranca al principio del script: el relleno va después.
    const session = runDiagnosticSession(`${SOURCE}\n${filler}`, TRACEBACK, [adapter]);
    const escalated = await escalateSession(session, adapter);

    const sent = JSON.stringify(requests[0].body.messages);
    expect(sent).toContain("import pandas as pd");
    expect(sent).not.toContain("secret_");
    expect(sent).not.toContain("C:\\\\Users");
    expect(sent).not.toContain("/home/ana");
    expect(escalated.patch).toBeUndefined();
    expect(escalated.modelNote).toBe("sin cambio");
  });
});
