import { describe, expect, it } from "vitest";
import { applySessionRepair, escalateSession, runDiagnosticSession } from "./engine";
import { GlimmerAdapter, parseGeneratedPatch } from "./glimmer";
import { SAMPLE_CASES } from "./samples";

interface CapturedRequest {
  url: string;
  body: { model: string; messages: Array<{ role: string; content: string }>; max_tokens: number };
}

function fakeFetch(content: string, init: { status?: number; usage?: object } = {}) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (url: string, request: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(request.body)) });
    const payload = { choices: [{ message: { content } }], usage: init.usage ?? { prompt_tokens: 120, completion_tokens: 30 } };
    return new Response(init.status && init.status >= 400 ? "rate limited" : JSON.stringify(payload), { status: init.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

function adapterWith(content: string, init?: { status?: number; usage?: object }) {
  const fake = fakeFetch(content, init);
  return { adapter: new GlimmerAdapter({ endpoint: "/api/glimmer/chat/completions", model: "muse-glimmer", fetchImpl: fake.fetchImpl }), requests: fake.requests };
}

function sample(id: string) {
  const found = SAMPLE_CASES.find((item) => item.id === id);
  if (!found) throw new Error(`Caso inexistente: ${id}`);
  return found;
}

const MERGE_FIX = JSON.stringify({
  before: 'on="customer_id"',
  after: 'left_on="customer_id", right_on="client_id"',
  explanation: "La clave del cliente se llama distinto en cada DataFrame.",
});

describe("GlimmerAdapter en modo benchmark", () => {
  it("el plan queda disponible sólo cuando hay un adaptador de nivel 2", () => {
    const { adapter } = adapterWith(MERGE_FIX);
    const { code, traceback } = sample("merge-alignment");
    expect(runDiagnosticSession(code, traceback).escalation.available).toBe(false);
    expect(runDiagnosticSession(code, traceback, [adapter]).escalation).toMatchObject({ level: 2, available: true });
  });

  it("escala el merge, registra métricas y el patch pasa los checkers", async () => {
    const { adapter, requests } = adapterWith(MERGE_FIX);
    const { code, traceback } = sample("merge-alignment");
    const analyzed = runDiagnosticSession(code, traceback, [adapter]);
    expect(analyzed.checkers.find((checker) => checker.id === "merge-keys")?.passed).toBe(false);

    const escalated = await escalateSession(analyzed, adapter);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({ model: "muse-glimmer", max_tokens: 512 });
    expect(escalated.patch?.origin).toBe("model");
    expect(escalated.metrics).toMatchObject({ calls: 1, generativeTokens: 150 });
    expect(escalated.escalation.used).toBe(true);
    expect(escalated.flags.some((flag) => flag.functionName === "escalateToModel" && flag.phase === "success")).toBe(true);

    const repaired = applySessionRepair(escalated);
    expect(repaired.status).toBe("verified");
    expect(repaired.checkers.map((checker) => checker.id)).toEqual(["syntax-delimiters", "merge-keys", "within-context"]);
  });

  it("envía sólo el contexto redactado, nunca el resto del script", async () => {
    const { adapter, requests } = adapterWith(JSON.stringify({ before: "", after: "", explanation: "sin cambio" }));
    const filler = Array.from({ length: 20 }, (_, i) => `secret_${i} = "C:\\\\Users\\\\ana\\\\data_${i}.csv"`).join("\n");
    const source = `${filler}\nimport numpy as np\nX_test = np.ones((4, 3))\npredictions = model.predict(X_test)`;
    const traceback = 'File "/home/ana/proyecto/train.py"\nValueError: X has 3 features, but model expects 4';
    const session = runDiagnosticSession(source, traceback, [adapter]);
    await escalateSession(session, adapter);

    const sent = JSON.stringify(requests[0].body.messages);
    expect(sent).toContain("np.ones((4, 3))");
    expect(sent).not.toContain("secret_0");
    expect(sent).not.toContain("/home/ana");
  });

  it("acepta JSON dentro de un bloque ```json y quita prefijos de línea", () => {
    const parsed = parseGeneratedPatch('Claro:\n```json\n{"before": "3: X_test = np.ones((4, 3))", "after": "X_test = np.ones((4, 4))", "explanation": "x"}\n```');
    expect(parsed.before).toBe("X_test = np.ones((4, 3))");
  });

  it("verifica la shape de un patch generado contra lo que espera el modelo", async () => {
    const { adapter } = adapterWith(JSON.stringify({ before: "np.ones((4, 3))", after: "np.ones((4, 4))", explanation: "ajusta features" }));
    const { code, traceback } = sample("shape-mismatch");
    const repaired = applySessionRepair(await escalateSession(runDiagnosticSession(code, traceback, [adapter]), adapter));
    expect(repaired.status).toBe("verified");
  });

  it("descarta un patch cuyo fragmento no está en el código", async () => {
    const { adapter } = adapterWith(JSON.stringify({ before: "df.join(other)", after: "df.merge(other)", explanation: "x" }));
    const { code, traceback } = sample("merge-alignment");
    const escalated = await escalateSession(runDiagnosticSession(code, traceback, [adapter]), adapter);
    expect(escalated.patch).toBeUndefined();
    expect(escalated.modelNote).toMatch(/descartó/);
    expect(escalated.metrics.calls).toBe(1);
  });

  it("rechaza en el checker un patch que toca líneas fuera del contexto", async () => {
    const filler = Array.from({ length: 12 }, (_, i) => `step_${i} = ${i}`).join("\n");
    const source = `${filler}\norders = pd.DataFrame({"customer_id": [1]})\nprofiles = pd.DataFrame({"client_id": [1]})\njoined = orders.merge(profiles, on="customer_id")`;
    const { adapter } = adapterWith(JSON.stringify({ before: "step_0 = 0", after: "step_0 = 1", explanation: "x" }));
    const session = runDiagnosticSession(source, "KeyError: 'customer_id' while merging", [adapter]);
    const repaired = applySessionRepair(await escalateSession(session, adapter));
    expect(repaired.status).toBe("failed");
    expect(repaired.checkers.find((checker) => checker.id === "within-context")?.passed).toBe(false);
  });

  it("propaga un error HTTP con el estado y deja el flag de error", async () => {
    const { adapter } = adapterWith("", { status: 429 });
    const { code, traceback } = sample("merge-alignment");
    await expect(escalateSession(runDiagnosticSession(code, traceback, [adapter]), adapter)).rejects.toThrow(/429/);
  });

  it("no escala si las reglas locales ya resolvieron", async () => {
    const { adapter, requests } = adapterWith(MERGE_FIX);
    const { code, traceback } = sample("missing-column");
    await expect(escalateSession(runDiagnosticSession(code, traceback, [adapter]), adapter)).rejects.toThrow(/reparación local/);
    expect(requests).toHaveLength(0);
  });
});
