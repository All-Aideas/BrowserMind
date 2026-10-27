import { describe, expect, it } from "vitest";
import { applySessionRepair, escalateSession, runDiagnosticSession } from "./engine";
import { MetaModelApiAdapter } from "./metaModelApi";
import { FALLBACK_SUFFIX, REPLAY_URL, adapterForLevel, createModelAdapters, modeFromLocation } from "./models";
import { recordingFetch, toReplayFile, type ReplayRecord } from "./replay";
import { SAMPLE_CASES } from "./samples";

const merge = SAMPLE_CASES.find((item) => item.id === "merge-alignment")!;
const MERGE_FIX = JSON.stringify({ before: 'on="customer_id"', after: 'left_on="customer_id", right_on="client_id"', explanation: "x" });

function completionFetch(content: string) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

describe("createModelAdapters", () => {
  it("sin Glimmer, Spark atiende el nivel 2 como respaldo explícito y el merge se verifica", async () => {
    const live = completionFetch(MERGE_FIX);
    const setup = await createModelAdapters({ glimmer: false, fetchImpl: live.fetchImpl });
    expect(setup.adapters.map((adapter) => adapter.level)).toEqual([2, 3]);
    expect(setup.adapters[0].model).toBe(`muse-spark-1.3${FALLBACK_SUFFIX}`);

    const session = runDiagnosticSession(merge.code, merge.traceback, setup.adapters);
    expect(session.escalation).toMatchObject({ level: 2, available: true });
    const adapter = adapterForLevel(setup.adapters, session.escalation.level)!;
    const repaired = applySessionRepair(await escalateSession(session, adapter));
    expect(repaired.status).toBe("verified");
    expect(live.urls).toEqual(["/api/meta/chat/completions"]);
  });

  it("el harness de Spark cierra cada llamada como accepted o rejected según los checkers", async () => {
    const good = await createModelAdapters({ glimmer: false, fetchImpl: completionFetch(MERGE_FIX).fetchImpl });
    const goodAdapter = adapterForLevel(good.adapters, 2)!;
    await escalateSession(runDiagnosticSession(merge.code, merge.traceback, good.adapters), goodAdapter);
    expect(goodAdapter.harness?.all()).toMatchObject([{ status: "accepted", checkerPassRate: 1, model: `muse-spark-1.3${FALLBACK_SUFFIX}` }]);

    const wrong = JSON.stringify({ before: 'on="customer_id"', after: 'on="customer_id", how="left"', explanation: "x" });
    const bad = await createModelAdapters({ glimmer: false, fetchImpl: completionFetch(wrong).fetchImpl });
    const badAdapter = adapterForLevel(bad.adapters, 2)!;
    await escalateSession(runDiagnosticSession(merge.code, merge.traceback, bad.adapters), badAdapter);
    expect(badAdapter.harness?.all()).toMatchObject([{ status: "rejected" }]);
  });

  it("con Glimmer habilitado, el nivel 2 va a Glimmer y el 3 a Spark", async () => {
    const live = completionFetch(MERGE_FIX);
    const setup = await createModelAdapters({ glimmer: true, fetchImpl: live.fetchImpl });
    expect(setup.adapters.map((adapter) => [adapter.level, adapter.model])).toEqual([[2, "muse-glimmer"], [3, "muse-spark-1.3"]]);
    const session = runDiagnosticSession(merge.code, merge.traceback, setup.adapters);
    await escalateSession(session, adapterForLevel(setup.adapters, 2)!);
    expect(live.urls).toEqual(["/api/glimmer/chat/completions"]);
  });

  it("en modo replay sirve lo grabado sin llamar a ningún endpoint de modelo", async () => {
    // Grabar con el mismo armado que usará la demo.
    const records: ReplayRecord[] = [];
    const live = completionFetch(MERGE_FIX);
    const recorder = await createModelAdapters({ glimmer: false, fetchImpl: recordingFetch(live.fetchImpl, records) });
    const recorded = runDiagnosticSession(merge.code, merge.traceback, recorder.adapters);
    await escalateSession(recorded, adapterForLevel(recorder.adapters, 2)!);

    const requested: string[] = [];
    const staticFetch = (async (url: string) => {
      requested.push(String(url));
      return new Response(JSON.stringify(toReplayFile(records)));
    }) as unknown as typeof fetch;
    const setup = await createModelAdapters({ mode: "replay", fetchImpl: staticFetch });
    expect(setup.notes[0]).toMatch(/1 respuestas grabadas/);
    const session = runDiagnosticSession(merge.code, merge.traceback, setup.adapters);
    const pending = escalateSession(session, adapterForLevel(setup.adapters, 2)!);
    const repaired = applySessionRepair(await pending);
    expect(repaired.status).toBe("verified");
    expect(requested).toEqual([REPLAY_URL]);
  }, 10_000);

  it("si falta el archivo de replay, quedan sólo las reglas locales y se explica por qué", async () => {
    const missing = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const setup = await createModelAdapters({ mode: "replay", fetchImpl: missing });
    expect(setup.adapters).toEqual([]);
    expect(setup.notes[0]).toMatch(/Replay no disponible \(HTTP 404\)/);
  });

  it("el modo sale de ?replay o de VITE_MODEL_MODE", () => {
    expect(modeFromLocation("?replay", undefined)).toBe("replay");
    expect(modeFromLocation("", "replay")).toBe("replay");
    expect(modeFromLocation("?caso=merge", undefined)).toBe("live");
  });

  it("el respaldo delega en el mismo adaptador de Spark", async () => {
    const live = completionFetch(MERGE_FIX);
    const spark = new MetaModelApiAdapter({ fetchImpl: live.fetchImpl });
    const setup = await createModelAdapters({ glimmer: false, fetchImpl: live.fetchImpl });
    expect(setup.adapters[1].model).toBe(spark.model);
  });
});
