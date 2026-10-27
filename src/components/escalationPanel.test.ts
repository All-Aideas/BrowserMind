import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { runDiagnosticSession } from "../core/engine";
import { createModelAdapters } from "../core/models";
import { repairWithRetry } from "../core/repairLoop";
import { SAMPLE_CASES } from "../core/samples";
import { EscalationPanel } from "./EscalationPanel";
import { attemptLabel, escalationView, resultSummary } from "./escalationView";

const merge = SAMPLE_CASES.find((item) => item.id === "merge-alignment")!;
const local = SAMPLE_CASES.find((item) => item.id === "missing-column")!;
const patch = (before: string, after: string) => JSON.stringify({ before, after, explanation: "x" });

function scripted(contents: string[]) {
  let calls = 0;
  return (async () => {
    const content = contents[Math.min(calls++, contents.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  }) as unknown as typeof fetch;
}

describe("panel de escalamiento", () => {
  it("muestra el modelo que atiende el nivel y habilita reparar", async () => {
    const { adapters } = await createModelAdapters({ glimmer: false, fetchImpl: scripted([]) });
    const session = runDiagnosticSession(merge.code, merge.traceback, adapters);
    expect(escalationView(session, adapters)).toMatchObject({ level: 2, connected: true, canRepair: true, model: "muse-spark-1.3 · respaldo de nivel 2" });

    const html = renderToStaticMarkup(createElement(EscalationPanel, { session, adapters, notes: ["Replay: 3 respuestas grabadas"], onResult: () => {} }));
    expect(html).toContain("ESCALAMIENTO · NIVEL 2");
    expect(html).toContain("Reparar con muse-spark-1.3 · respaldo de nivel 2");
    expect(html).toContain("Replay: 3 respuestas grabadas");
  });

  it("sin adaptador avisa que el nivel no está conectado y no ofrece reparar", () => {
    const session = runDiagnosticSession(merge.code, merge.traceback);
    expect(escalationView(session, [])).toMatchObject({ connected: false, canRepair: false, model: "Muse Glimmer" });
    const html = renderToStaticMarkup(createElement(EscalationPanel, { session, adapters: [], onResult: () => {} }));
    expect(html).toContain("· no conectado");
    expect(html).not.toContain("Reparar con");
  });

  it("no se muestra cuando las reglas locales ya resolvieron", () => {
    const session = runDiagnosticSession(local.code, local.traceback);
    expect(renderToStaticMarkup(createElement(EscalationPanel, { session, adapters: [], onResult: () => {} }))).toBe("");
  });

  it("resume el reintento: rechazo por checker, verificación y tokens", async () => {
    const fetchImpl = scripted([patch('on="customer_id"', 'on="customer_id", how="left"'), patch('on="customer_id"', 'left_on="customer_id", right_on="client_id"')]);
    const { adapters } = await createModelAdapters({ glimmer: false, fetchImpl });
    const session = runDiagnosticSession(merge.code, merge.traceback, adapters);
    const result = await repairWithRetry(session, adapters[0]);
    expect(result.attempts.map(attemptLabel)).toEqual([
      "Intento 1 · rechazado por merge-keys · 120 tokens",
      "Intento 2 · verificado · 120 tokens",
    ]);
    expect(resultSummary(result)).toBe("Patch verificado · 2 llamadas · 240 tokens");
  });
});
