import { describe, expect, it } from "vitest";
import { escalateSession, runDiagnosticSession } from "./engine";
import { retrySessionRepair } from "./retry";
import { SAMPLE_CASES } from "./samples";
import type { ModelAdapter, ModelProposal } from "./escalation";

const badPatch: NonNullable<ModelProposal["patch"]> = {
  id: "bad",
  title: "Patch rechazable",
  explanation: "cambio incorrecto",
  mode: "replace",
  before: 'on="customer_id"',
  after: 'on="client_id"',
  changedLine: 6,
  safety: "guarded",
  origin: "model",
};

const goodPatch: NonNullable<ModelProposal["patch"]> = {
  ...badPatch,
  id: "good",
  after: 'left_on="customer_id", right_on="client_id"',
};

function sample(id: string) {
  const found = SAMPLE_CASES.find((item) => item.id === id);
  if (!found) throw new Error(`Caso inexistente: ${id}`);
  return found;
}

describe("retrySessionRepair", () => {
  it("reenvía el feedback de los checkers y acepta un patch corregido", async () => {
    const contexts: string[] = [];
    let calls = 0;
    const adapter: ModelAdapter = {
      level: 2,
      model: "fake-glimmer",
      proposePatch: async (context) => {
        contexts.push(context.payload);
        calls += 1;
        return {
          patch: calls === 1 ? badPatch : goodPatch,
          rationale: "intento",
          usage: { promptTokens: 50, completionTokens: 20, latencyMs: 1 },
        };
      },
    };
    const { code, traceback } = sample("merge-alignment");
    const initial = await escalateSession(runDiagnosticSession(code, traceback, [adapter]), adapter);
    const result = await retrySessionRepair(initial, adapter);

    expect(result.stopReason).toBe("verified");
    expect(result.attempts).toBe(1);
    expect(result.session.status).toBe("verified");
    expect(contexts[1]).toContain("checkers rojos");
    expect(result.session.metrics.calls).toBe(2);
  });

  it("corta cuando la nueva llamada supera el presupuesto de tokens", async () => {
    const adapter: ModelAdapter = {
      level: 2,
      model: "expensive-model",
      proposePatch: async () => ({
        patch: badPatch,
        rationale: "intento caro",
        usage: { promptTokens: 700, completionTokens: 400, latencyMs: 1 },
      }),
    };
    const { code, traceback } = sample("merge-alignment");
    const initial = await escalateSession(runDiagnosticSession(code, traceback, [adapter]), adapter);
    const result = await retrySessionRepair(initial, adapter, { maxAdditionalTokens: 100 });

    expect(result.stopReason).toBe("token-budget");
    expect(result.session.status).toBe("failed");
    expect(result.attempts).toBe(1);
  });
});
