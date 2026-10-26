import { describe, expect, it } from "vitest";
import { escalateSession, runDiagnosticSession } from "./engine";
import { MetaModelApiAdapter } from "./metaModelApi";
import { parseReplayFile, recordingFetch, replayFetch, replayKey, toReplayFile, type ReplayRecord } from "./replay";

const SOURCE = [
  "import pandas as pd",
  'df = pd.DataFrame({"price": [10, 20], "qty": [1, 2]})',
  'total = df["price"] * df["qty"]',
  "result = total.rolling(window=0).mean()",
].join("\n");
const TRACEBACK = "ValueError: min_periods 1 must be <= window 0";
const ANSWER = JSON.stringify({ before: "window=0", after: "window=2", explanation: "ventana válida" });

function liveFetch(content: string, status = 200) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (status >= 400) return new Response("rate limited", { status });
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 210, completion_tokens: 90 },
    }), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

async function record(content = ANSWER): Promise<ReplayRecord[]> {
  const records: ReplayRecord[] = [];
  const live = liveFetch(content);
  const adapter = new MetaModelApiAdapter({ fetchImpl: recordingFetch(live.fetchImpl, records) });
  await escalateSession(runDiagnosticSession(SOURCE, TRACEBACK, [adapter]), adapter);
  return records;
}

describe("modo replay (T7)", () => {
  it("graba una llamada y la reproduce sin red con el mismo resultado y las mismas métricas", async () => {
    const records = await record();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ source: "recorded", model: "muse-spark-1.3", status: 200 });

    const adapter = new MetaModelApiAdapter({ fetchImpl: replayFetch(parseReplayFile(JSON.parse(JSON.stringify(toReplayFile(records))))) });
    const replayed = await escalateSession(runDiagnosticSession(SOURCE, TRACEBACK, [adapter]), adapter);
    expect(replayed.patch).toMatchObject({ origin: "model", after: "window=2" });
    expect(replayed.metrics).toMatchObject({ calls: 1, generativeTokens: 300 });
  });

  it("si el contexto cambia, no reutiliza una grabación vieja: responde 404", async () => {
    const records = await record();
    const adapter = new MetaModelApiAdapter({ fetchImpl: replayFetch(records) });
    const changed = SOURCE.replace("[1, 2]", "[1, 3]");
    await expect(escalateSession(runDiagnosticSession(changed, TRACEBACK, [adapter]), adapter)).rejects.toThrow(/404.*no hay grabación/);
  });

  it("no graba respuestas con error", async () => {
    const records: ReplayRecord[] = [];
    const live = liveFetch("", 429);
    const adapter = new MetaModelApiAdapter({ fetchImpl: recordingFetch(live.fetchImpl, records) });
    await expect(escalateSession(runDiagnosticSession(SOURCE, TRACEBACK, [adapter]), adapter)).rejects.toThrow(/429/);
    expect(records).toHaveLength(0);
  });

  it("la grabación guarda el pedido redactado y ningún header", async () => {
    const records: ReplayRecord[] = [];
    const live = liveFetch(ANSWER);
    const adapter = new MetaModelApiAdapter({ fetchImpl: recordingFetch(live.fetchImpl, records) });
    const traceback = 'File "/home/ana/proyecto/report.py", line 4\nValueError: min_periods 1 must be <= window 0';
    await escalateSession(runDiagnosticSession(SOURCE, traceback, [adapter]), adapter);
    const file = JSON.stringify(toReplayFile(records));
    expect(file).not.toContain("/home/ana");
    expect(file).not.toMatch(/authorization|bearer/i);
    expect(records[0].request.messages[1].content).toContain("<ruta>");
  });

  it("la clave depende del modelo y de los mensajes", () => {
    const messages = [{ role: "user", content: "a" }];
    expect(replayKey({ model: "m", messages })).toBe(replayKey({ model: "m", messages: [{ role: "user", content: "a" }] }));
    expect(replayKey({ model: "m", messages })).not.toBe(replayKey({ model: "n", messages }));
    expect(replayKey({ model: "m", messages })).not.toBe(replayKey({ model: "m", messages: [{ role: "user", content: "b" }] }));
  });

  it("puede simular la latencia grabada y respeta la cancelación", async () => {
    const records = (await record()).map((item) => ({ ...item, latencyMs: 5_000 }));
    const fetchImpl = replayFetch(records, { simulateLatency: true });
    const adapter = new MetaModelApiAdapter({ fetchImpl });
    const controller = new AbortController();
    const pending = escalateSession(runDiagnosticSession(SOURCE, TRACEBACK, [adapter]), adapter, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelado/);
  });

  it("rechaza archivos de replay con otro formato", () => {
    expect(() => parseReplayFile({ records: [] })).toThrow(/inválido/);
    expect(parseReplayFile({ version: 1, records: [{ key: 1 }] })).toEqual([]);
  });
});
