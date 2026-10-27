import type { ModelAdapter } from "../core/escalation";
import { adapterForLevel } from "../core/models";
import type { RepairAttempt, RetryResult, RetryStop } from "../core/repairLoop";
import type { DiagnosticSession } from "../core/types";

/** Textos del panel de escalamiento, separados del componente para testearlos sin DOM. */
export interface EscalationView {
  level: number;
  model: string;
  connected: boolean;
  /** Se puede pedir un patch: hay adaptador, no hay reparación local y no se escaló todavía. */
  canRepair: boolean;
  reason: string;
}

export function escalationView(session: DiagnosticSession, adapters: readonly ModelAdapter[]): EscalationView {
  const { level, reason, used } = session.escalation;
  const adapter = level === 0 ? undefined : adapterForLevel(adapters, level);
  return {
    level,
    model: adapter?.model ?? session.escalation.model,
    connected: adapter !== undefined,
    canRepair: adapter !== undefined && !session.patch && !used,
    reason,
  };
}

const STOP_LABEL: Record<RetryStop, string> = {
  verified: "Patch verificado",
  declined: "El modelo no encontró un cambio seguro",
  attempts: "Sin patch verificado tras los intentos permitidos",
  budget: "Se cortó por el presupuesto de tokens",
};

export function stopLabel(result: RetryResult): string {
  return STOP_LABEL[result.stoppedBy];
}

export function attemptLabel(attempt: RepairAttempt): string {
  const outcome = attempt.verified
    ? "verificado"
    : attempt.failedCheckers.length
      ? `rechazado por ${attempt.failedCheckers.join(", ")}`
      : attempt.patch ? "rechazado" : attempt.note ?? "sin patch";
  return `Intento ${attempt.attempt} · ${outcome} · ${attempt.tokens} tokens`;
}

export function resultSummary(result: RetryResult): string {
  const tokens = result.attempts.reduce((sum, attempt) => sum + attempt.tokens, 0);
  const calls = result.attempts.length;
  return `${stopLabel(result)} · ${calls} ${calls === 1 ? "llamada" : "llamadas"} · ${tokens} tokens`;
}
