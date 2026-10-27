import { redactSensitive } from "./diagnostics";
import { applySessionRepair, escalateSession } from "./engine";
import type { ModelAdapter } from "./escalation";
import type { CheckerResult, DiagnosticSession, RepairPatch } from "./types";

/**
 * Reintento barato cuando los checkers rechazan un patch generado (T6).
 *
 * En vez de subir de nivel, vuelve a llamar al mismo modelo con el mismo contexto
 * redactado más un bloque de feedback: el diff rechazado, los checkers que fallaron y,
 * si hay runtime, el traceback nuevo. El presupuesto de tokens corta antes de gastar
 * más que lo previsto. Sólo usa la API pública de engine.
 */
export interface RetryOptions {
  /** Intentos totales, incluido el primero. */
  maxAttempts?: number;
  /** Tokens generativos (prompt + completion) que la sesión puede gastar en total. */
  tokenBudget?: number;
  signal?: AbortSignal;
  /** Ejecuta el código parcheado (por ejemplo, con Pyodide) y devuelve el traceback, si falla. */
  runPatched?: (code: string) => Promise<string | undefined>;
}

export type RetryStop = "verified" | "declined" | "attempts" | "budget";

export interface RepairAttempt {
  attempt: number;
  /** Payload exacto que viajó al modelo en este intento. */
  payload: string;
  patch?: RepairPatch;
  verified: boolean;
  failedCheckers: string[];
  tokens: number;
  note?: string;
}

export interface RetryResult {
  session: DiagnosticSession;
  attempts: RepairAttempt[];
  stoppedBy: RetryStop;
}

export const FEEDBACK_HEADER = "# intento anterior rechazado (no lo repitas)";

const MAX_FEEDBACK_CHARS = 600;

function clip(text: string): string {
  return text.length > MAX_FEEDBACK_CHARS ? `${text.slice(0, MAX_FEEDBACK_CHARS)}…` : text;
}

/** Bloque que se agrega al contexto del reintento. Todo pasa por la misma redacción. */
export function buildRetryFeedback(
  rejected: { patch?: RepairPatch; discarded?: string; note?: string; failed: CheckerResult[]; traceback?: string },
): string {
  const lines = [FEEDBACK_HEADER];
  if (rejected.patch) {
    lines.push(`- ${rejected.patch.before}`, `+ ${rejected.patch.after}`);
  } else if (rejected.discarded !== undefined) {
    lines.push(`fragmento descartado: ${rejected.discarded}`);
  }
  if (rejected.note) lines.push(`motivo: ${rejected.note}`);
  for (const checker of rejected.failed) lines.push(`checker «${checker.name}»: ${checker.message}`);
  if (rejected.traceback) lines.push("traceback al ejecutar el patch:", rejected.traceback.trim());
  return clip(redactSensitive(lines.join("\n")));
}

/** Fragmento que escalateSession descartó (no coincide o es ambiguo), según su flag de error. */
function discardedFragment(session: DiagnosticSession, flagsBefore: number): string | undefined {
  return session.flags.slice(flagsBefore).find((flag) => flag.functionName === "escalateToModel"
    && flag.phase === "error" && flag.message.startsWith("Patch descartado"))?.details;
}

export async function repairWithRetry(
  session: DiagnosticSession,
  adapter: ModelAdapter,
  options: RetryOptions = {},
): Promise<RetryResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
  const tokenBudget = options.tokenBudget ?? 6000;
  const attempts: RepairAttempt[] = [];
  const baseContext = session.context;
  let feedback = "";
  let current = session;

  for (let attempt = 1; ; attempt += 1) {
    const payload = feedback ? `${baseContext.payload}\n${feedback}` : baseContext.payload;
    // Cada intento parte de la sesión analizada; sólo se arrastran flags y métricas.
    const request: DiagnosticSession = { ...session, flags: current.flags, metrics: current.metrics, context: { ...baseContext, payload } };
    const tokensBefore = request.metrics.generativeTokens;
    const flagsBefore = request.flags.length;
    const escalated = await escalateSession(request, adapter, options.signal);
    const tokens = escalated.metrics.generativeTokens - tokensBefore;
    const spent = escalated.metrics.generativeTokens - session.metrics.generativeTokens;

    let stop: RetryStop | undefined;
    let failed: CheckerResult[] = [];
    let traceback: string | undefined;
    const discarded = discardedFragment(escalated, flagsBefore);
    if (!escalated.patch) {
      current = { ...escalated, status: "failed" };
      if (discarded === undefined) stop = "declined";
    } else {
      current = applySessionRepair(escalated);
      failed = current.checkers.filter((checker) => !checker.passed);
      if (failed.length === 0 && options.runPatched && current.patchedSource !== undefined) {
        traceback = await options.runPatched(current.patchedSource);
        if (traceback) {
          failed = [{ id: "runtime", name: "Ejecución del patch", passed: false, message: "El código parcheado sigue fallando." }];
          current = {
            ...current,
            status: "failed",
            checkers: [...current.checkers, failed[0]],
          };
        }
      }
      if (failed.length === 0) stop = "verified";
    }

    attempts.push({
      attempt,
      payload,
      patch: escalated.patch,
      verified: stop === "verified",
      failedCheckers: failed.map((checker) => checker.id),
      tokens,
      note: escalated.modelNote,
    });

    if (!stop && attempt >= maxAttempts) stop = "attempts";
    // Se asume que el próximo intento cuesta lo mismo que éste: no se arranca si no entra.
    if (!stop && spent + tokens > tokenBudget) stop = "budget";
    if (stop) return { session: current, attempts, stoppedBy: stop };

    feedback = buildRetryFeedback({ patch: escalated.patch, discarded, note: escalated.modelNote, failed, traceback });
  }
}
