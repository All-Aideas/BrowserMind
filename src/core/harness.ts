import type { ModelProposal, ModelUsage } from "./escalation";
import type { EscalationLevel, RepairPatch } from "./types";

export type HarnessStatus = "received" | "accepted" | "rejected" | "empty" | "failed";

export interface HarnessCallRecord {
  id: string;
  recordedAt: string;
  model: string;
  level: Exclude<EscalationLevel, 0>;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: HarnessStatus;
  rationale?: string;
  error?: string;
  checkerPassRate?: number;
}

export interface HarnessTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  failedCalls: number;
  acceptedCalls: number;
  rejectedCalls: number;
}

export interface ProposalValidation {
  accepted: boolean;
  reason: string;
  /** Identifica el registro pendiente de pasar por checkers. */
  recordId?: string;
}

function proposalPatchIsStructurallyApplicable(source: string, patch: RepairPatch): ProposalValidation {
  if (patch.origin !== "model") {
    return { accepted: false, reason: "El patch recibido no está marcado como generado por modelo." };
  }
  if (!patch.before && patch.mode === "replace") {
    return { accepted: false, reason: "El modelo no devolvió el fragmento que debe reemplazarse." };
  }
  if (patch.before === patch.after) {
    return { accepted: false, reason: "El modelo devolvió un cambio sin efecto." };
  }
  if (patch.mode === "replace" && !source.includes(patch.before)) {
    return { accepted: false, reason: "El fragmento propuesto no existe en el código contextual." };
  }
  if (patch.mode === "insert" && (patch.changedLine === undefined || patch.changedLine < 1)) {
    return { accepted: false, reason: "El patch de inserción no tiene una línea válida." };
  }
  return { accepted: true, reason: "La respuesta tiene una forma aplicable; todavía debe pasar los checkers." };
}

export function validateModelProposal(source: string, proposal: ModelProposal): ProposalValidation {
  if (!proposal.patch) {
    return { accepted: false, reason: "El modelo no propuso un cambio seguro." };
  }
  return proposalPatchIsStructurallyApplicable(source, proposal.patch);
}

export class ModelHarness {
  private readonly records: HarnessCallRecord[] = [];

  record(input: Omit<HarnessCallRecord, "id" | "recordedAt" | "totalTokens">): HarnessCallRecord {
    const record: HarnessCallRecord = {
      ...input,
      id: `model-call-${this.records.length + 1}`,
      recordedAt: new Date().toISOString(),
      totalTokens: input.promptTokens + input.completionTokens,
    };
    this.records.push(record);
    return record;
  }

  recordProposal(
    source: string,
    model: string,
    level: Exclude<EscalationLevel, 0>,
    proposal: ModelProposal,
  ): ProposalValidation {
    const validation = validateModelProposal(source, proposal);
    const record = this.record({
      model,
      level,
      promptTokens: proposal.usage.promptTokens,
      completionTokens: proposal.usage.completionTokens,
      latencyMs: proposal.usage.latencyMs,
      status: proposal.patch ? (validation.accepted ? "received" : "rejected") : "empty",
      rationale: proposal.rationale,
    });
    return { ...validation, recordId: record.id };
  }

  finalizeProposal(recordId: string, accepted: boolean, checkerPassRate: number, rationale?: string): HarnessCallRecord {
    const index = this.records.findIndex((record) => record.id === recordId);
    if (index === -1) throw new Error(`No existe la llamada de modelo ${recordId}.`);
    const current = this.records[index];
    if (!current) throw new Error(`No existe la llamada de modelo ${recordId}.`);
    const finalized: HarnessCallRecord = {
      ...current,
      status: accepted ? "accepted" : "rejected",
      checkerPassRate,
      rationale: rationale ?? current.rationale,
    };
    this.records[index] = finalized;
    return finalized;
  }

  recordFailure(
    model: string,
    level: Exclude<EscalationLevel, 0>,
    usage: Pick<ModelUsage, "promptTokens" | "completionTokens" | "latencyMs">,
    error: string,
  ): HarnessCallRecord {
    return this.record({ model, level, ...usage, status: "failed", error });
  }

  all(): HarnessCallRecord[] {
    return [...this.records];
  }

  totals(): HarnessTotals {
    return this.records.reduce<HarnessTotals>((totals, record) => ({
      calls: totals.calls + 1,
      promptTokens: totals.promptTokens + record.promptTokens,
      completionTokens: totals.completionTokens + record.completionTokens,
      totalTokens: totals.totalTokens + record.totalTokens,
      failedCalls: totals.failedCalls + (record.status === "failed" ? 1 : 0),
      acceptedCalls: totals.acceptedCalls + (record.status === "accepted" ? 1 : 0),
      rejectedCalls: totals.rejectedCalls + (["rejected", "empty"].includes(record.status) ? 1 : 0),
    }), {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      failedCalls: 0,
      acceptedCalls: 0,
      rejectedCalls: 0,
    });
  }
}
