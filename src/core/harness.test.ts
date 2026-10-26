import { describe, expect, it } from "vitest";
import { ModelHarness, validateModelProposal } from "./harness";
import type { ModelProposal } from "./escalation";

function proposal(patch?: ModelProposal["patch"]): ModelProposal {
  return {
    rationale: "cambio mínimo",
    usage: { promptTokens: 10, completionTokens: 4, latencyMs: 25 },
    patch,
  };
}

const modelPatch = {
  id: "model-patch",
  title: "Patch de prueba",
  explanation: "Reemplazo controlado",
  mode: "replace" as const,
  before: "x = 1",
  after: "x = 2",
  safety: "guarded" as const,
  origin: "model" as const,
};

describe("harness de modelos", () => {
  it("acepta una propuesta estructuralmente aplicable", () => {
    expect(validateModelProposal("x = 1\nprint(x)", proposal(modelPatch))).toEqual({
      accepted: true,
      reason: "La respuesta tiene una forma aplicable; todavía debe pasar los checkers.",
    });
  });

  it("rechaza un fragmento que no está en el contexto", () => {
    const result = validateModelProposal("x = 1", proposal({ ...modelPatch, before: "y = 9" }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("no existe");
  });

  it("rechaza una respuesta sin cambio o sin patch", () => {
    expect(validateModelProposal("x = 1", proposal()).accepted).toBe(false);
    expect(validateModelProposal("x = 1", proposal({ ...modelPatch, before: "x = 1", after: "x = 1" })).accepted).toBe(false);
  });

  it("concilia tokens, llamadas y estados", () => {
    const harness = new ModelHarness();
    harness.recordProposal("x = 1", "Muse Glimmer", 2, proposal(modelPatch));
    harness.recordFailure("Muse Glimmer", 2, { promptTokens: 8, completionTokens: 0, latencyMs: 12 }, "timeout");
    expect(harness.totals()).toMatchObject({
      calls: 2,
      promptTokens: 18,
      completionTokens: 4,
      totalTokens: 22,
      failedCalls: 1,
      acceptedCalls: 1,
    });
  });
});
