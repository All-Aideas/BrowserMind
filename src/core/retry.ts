import { applySessionRepair, escalateSession } from "./engine";
import type { ModelAdapter } from "./escalation";
import type { DiagnosticSession, RepairPatch, SelectedContext } from "./types";

export interface RetryPolicy {
  /** Cantidad máxima de nuevas llamadas después del patch rechazado. */
  maxAttempts?: number;
  /** Tokens generativos máximos para esas nuevas llamadas. */
  maxAdditionalTokens?: number;
}

export type RetryStopReason = "verified" | "max-attempts" | "token-budget" | "no-model-patch" | "not-eligible";

export interface RetryResult {
  session: DiagnosticSession;
  attempts: number;
  stopReason: RetryStopReason;
}

function retryContext(context: SelectedContext, patch: RepairPatch, session: DiagnosticSession, attempt: number): SelectedContext {
  const failedCheckers = session.checkers
    .filter((checker) => !checker.passed)
    .map((checker) => `- ${checker.name}: ${checker.message}`)
    .join("\n");
  const feedback = [
    context.payload,
    "",
    `# REINTENTO ${attempt}: el patch anterior fue rechazado por los checkers`,
    `# before: ${patch.before}`,
    `# after: ${patch.after}`,
    "# checkers rojos:",
    failedCheckers || "- No se pudo determinar el checker que falló.",
    "# Proponé un cambio mínimo distinto o devolvé before/after vacíos si no hay una reparación segura.",
  ].join("\n");
  return { ...context, payload: feedback };
}

export async function retrySessionRepair(
  session: DiagnosticSession,
  adapter: ModelAdapter,
  policy: RetryPolicy = {},
  signal?: AbortSignal,
): Promise<RetryResult> {
  const maxAttempts = Math.max(0, policy.maxAttempts ?? 2);
  const maxAdditionalTokens = Math.max(0, policy.maxAdditionalTokens ?? 1_024);
  if (!session.patch || session.patch.origin !== "model") {
    return { session, attempts: 0, stopReason: "not-eligible" };
  }

  let current = session.status === "failed" ? session : applySessionRepair(session);
  if (current.status !== "failed") return { session: current, attempts: 0, stopReason: "verified" };

  let attempts = 0;
  let additionalTokens = 0;
  while (attempts < maxAttempts) {
    const nextContext = retryContext(current.context, current.patch!, current, attempts + 1);
    const retryInput: DiagnosticSession = {
      ...current,
      status: "analyzed",
      patchedSource: undefined,
      patch: undefined,
      modelNote: undefined,
      context: nextContext,
    };
    const next = await escalateSession(retryInput, adapter, signal);
    attempts += 1;
    const callTokens = next.metrics.generativeTokens - current.metrics.generativeTokens;
    if (additionalTokens + callTokens > maxAdditionalTokens) {
      return { session: current, attempts, stopReason: "token-budget" };
    }
    additionalTokens += callTokens;
    if (!next.patch) return { session: next, attempts, stopReason: "no-model-patch" };
    current = applySessionRepair(next);
    if (current.status === "verified") return { session: current, attempts, stopReason: "verified" };
  }

  return { session: current, attempts, stopReason: "max-attempts" };
}
