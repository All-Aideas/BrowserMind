import { describe, expect, it } from "vitest";
import { runDiagnosticSession } from "./engine";
import { GlimmerAdapter } from "./glimmer";
import { FEEDBACK_HEADER, buildRetryFeedback, repairWithRetry } from "./repairLoop";
import { SAMPLE_CASES } from "./samples";

/** fetch que devuelve una respuesta distinta en cada llamada y guarda lo que se envió. */
function scripted(contents: string[], usage = { prompt_tokens: 300, completion_tokens: 50 }) {
  const sent: string[] = [];
  const fetchImpl = (async (_url: string, request: RequestInit) => {
    const body = JSON.parse(String(request.body)) as { messages: Array<{ content: string }> };
    sent.push(body.messages[1].content);
    const content = contents[Math.min(sent.length - 1, contents.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 });
  }) as unknown as typeof fetch;
  return { adapter: new GlimmerAdapter({ endpoint: "/api/glimmer/chat/completions", model: "muse-glimmer", fetchImpl }), sent };
}

const merge = SAMPLE_CASES.find((item) => item.id === "merge-alignment")!;
const patch = (before: string, after: string) => JSON.stringify({ before, after, explanation: "x" });
const WRONG = patch('on="customer_id"', 'on="customer_id", how="left"');
const RIGHT = patch('on="customer_id"', 'left_on="customer_id", right_on="client_id"');

describe("repairWithRetry (T6)", () => {
  it("si el checker rechaza, reintenta con el diff y el checker que falló, y verifica", async () => {
    const { adapter, sent } = scripted([WRONG, RIGHT]);
    const result = await repairWithRetry(runDiagnosticSession(merge.code, merge.traceback, [adapter]), adapter);

    expect(result.stoppedBy).toBe("verified");
    expect(result.session.status).toBe("verified");
    expect(result.attempts.map((attempt) => attempt.verified)).toEqual([false, true]);
    expect(result.attempts[0].failedCheckers).toContain("merge-keys");
    expect(sent[0]).not.toContain(FEEDBACK_HEADER);
    expect(sent[1]).toContain(FEEDBACK_HEADER);
    expect(sent[1]).toContain('+ on="customer_id", how="left"');
    expect(result.session.metrics).toMatchObject({ calls: 2, generativeTokens: 700 });
    expect(result.attempts[1].payload).toBe(result.session.context.payload);
  });

  it("si el fragmento se descartó por ambiguo, el reintento lo explica", async () => {
    const { adapter, sent } = scripted([patch('"customer_id"', '"client_id"'), RIGHT]);
    const result = await repairWithRetry(runDiagnosticSession(merge.code, merge.traceback, [adapter]), adapter);
    expect(result.stoppedBy).toBe("verified");
    expect(sent[1]).toContain('fragmento descartado: "customer_id"');
    expect(sent[1]).toMatch(/2 veces.*ambiguo/);
  });

  it("no reintenta si el modelo declara que no hay un cambio seguro", async () => {
    const { adapter, sent } = scripted([JSON.stringify({ before: "", after: "", explanation: "no es seguro" })]);
    const result = await repairWithRetry(runDiagnosticSession(merge.code, merge.traceback, [adapter]), adapter);
    expect(result.stoppedBy).toBe("declined");
    expect(sent).toHaveLength(1);
    expect(result.session.modelNote).toBe("no es seguro");
  });

  it("corta por presupuesto antes de un intento que no entra", async () => {
    const { adapter, sent } = scripted([WRONG, RIGHT]);
    const result = await repairWithRetry(runDiagnosticSession(merge.code, merge.traceback, [adapter]), adapter, { tokenBudget: 500 });
    expect(result.stoppedBy).toBe("budget");
    expect(sent).toHaveLength(1);
    expect(result.session.status).toBe("failed");
  });

  it("corta al llegar al máximo de intentos", async () => {
    const { adapter, sent } = scripted([WRONG]);
    const result = await repairWithRetry(runDiagnosticSession(merge.code, merge.traceback, [adapter]), adapter, { maxAttempts: 3 });
    expect(result.stoppedBy).toBe("attempts");
    expect(sent).toHaveLength(3);
  });

  it("usa el traceback del runtime cuando los checkers pasan pero el código sigue fallando", async () => {
    const { adapter, sent } = scripted([RIGHT, RIGHT]);
    let runs = 0;
    const runPatched = async () => (runs++ === 0 ? 'File "/home/ana/x.py", line 5\nNameError: name \'pd\' is not defined' : undefined);
    const result = await repairWithRetry(runDiagnosticSession(merge.code, merge.traceback, [adapter]), adapter, { runPatched });
    expect(result.stoppedBy).toBe("verified");
    expect(result.attempts[0].failedCheckers).toEqual(["runtime"]);
    expect(sent[1]).toContain("NameError");
    expect(sent[1]).not.toContain("/home/ana");
  });

  it("el feedback se redacta y se recorta", () => {
    const feedback = buildRetryFeedback({ failed: [], traceback: `C:\\Users\\ana\\data.csv ${"x".repeat(2000)}` });
    expect(feedback).not.toContain("ana");
    expect(feedback.length).toBeLessThan(700);
  });
});
