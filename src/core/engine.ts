import { FlagLog, trace, traceAsync } from "./flags";
import { classifyError, selectContext } from "./diagnostics";
import { planEscalation, type ModelAdapter } from "./escalation";
import { applyPatch, proposeRepair } from "./patches";
import { checkChangesWithinContext, runCheckers } from "./checkers";
import { parsePython } from "./parser";
import type { DiagnosticSession } from "./types";

function countOccurrences(source: string, fragment: string): number {
  return fragment ? source.split(fragment).length - 1 : 0;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function runDiagnosticSession(
  source: string,
  traceback: string,
  adapters: readonly ModelAdapter[] = [],
): DiagnosticSession {
  const flags = new FlagLog();
  const startedAt = performance.now();
  return trace(flags, "runDiagnosticSession", () => {
    const index = parsePython(source, flags);
    const diagnostic = classifyError(source, traceback, flags);
    const context = selectContext(source, index, diagnostic, flags);
    const patch = proposeRepair(source, diagnostic, index, flags);
    const checkers = runCheckers(source, diagnostic, flags);
    const escalation = planEscalation(diagnostic, patch, adapters, flags);
    return {
      id: crypto.randomUUID(),
      status: "analyzed",
      source,
      traceback,
      index,
      diagnostic,
      context,
      patch,
      checkers,
      escalation,
      flags: flags.all(),
      metrics: {
        // Las llamadas generativas sólo ocurren en escalateSession.
        calls: 0,
        estimatedTokens: estimateTokens(context.payload),
        generativeTokens: 0,
        modelLatencyMs: 0,
        selectedLines: context.lines.length,
        elapsedMs: Math.round(performance.now() - startedAt),
      },
    };
  });
}

/**
 * Pide un patch al modelo del nivel planificado. Envía sólo `session.context`.
 * El patch devuelto no se aplica: queda como propuesta y pasa por los mismos checkers.
 */
export async function escalateSession(
  session: DiagnosticSession,
  adapter: ModelAdapter,
  signal?: AbortSignal,
): Promise<DiagnosticSession> {
  const flags = new FlagLog(session.flags);
  if (session.patch) throw new Error("La sesión ya tiene una reparación local; no hace falta escalar.");
  if (adapter.level !== session.escalation.level) {
    throw new Error(`El plan pide nivel ${session.escalation.level} y el adaptador es de nivel ${adapter.level}.`);
  }

  const proposal = await traceAsync(flags, "escalateToModel", () =>
    adapter.proposePatch(session.context, session.diagnostic, signal));

  const harnessValidation = proposal.patch && adapter.harness
    ? adapter.harness.recordProposal(session.source, adapter.model, adapter.level, proposal)
    : undefined;

  // El fragmento debe aparecer exactamente una vez: si falta no se puede aplicar, y si se
  // repite el reemplazo podría tocar otras líneas (por ejemplo, la definición de los datos).
  const occurrences = proposal.patch ? countOccurrences(session.source, proposal.patch.before) : 0;
  const matches = proposal.patch !== undefined && occurrences === 1;
  const rejection = occurrences === 0
    ? "El patch generado no coincide con el código y se descartó."
    : `El fragmento del patch aparece ${occurrences} veces; se descartó por ambiguo.`;
  if (proposal.patch && !matches) {
    flags.add({
      functionName: "escalateToModel",
      phase: "error",
      level: "error",
      message: `Patch descartado: ${rejection}`,
      details: proposal.patch.before,
    });
    if (harnessValidation?.recordId && adapter.harness && harnessValidation.accepted) {
      adapter.harness.finalizeProposal(harnessValidation.recordId, false, 0, rejection);
    }
  }

  if (matches && harnessValidation?.recordId && adapter.harness && proposal.patch) {
    let checkerPassRate = 0;
    let accepted = false;
    let rationale = "El patch pasó la validación estructural y los checkers.";
    try {
      const patchedSource = applyPatch(session.source, proposal.patch);
      const checkerResults = runCheckers(patchedSource, session.diagnostic);
      const editable = session.context.lines.filter((line) => !session.context.readOnlyLines.includes(line));
      if (proposal.patch.origin === "model") checkerResults.push(checkChangesWithinContext(session.source, patchedSource, editable));
      checkerPassRate = checkerResults.length === 0 ? 0 : checkerResults.filter((checker) => checker.passed).length / checkerResults.length;
      accepted = checkerResults.length > 0 && checkerPassRate === 1;
      if (!accepted) rationale = `El patch fue rechazado por los checkers (${Math.round(checkerPassRate * 100)}% aprobados).`;
    } catch (error) {
      rationale = error instanceof Error ? error.message : "No se pudo verificar el patch generado.";
    }
    adapter.harness.finalizeProposal(harnessValidation.recordId, accepted, checkerPassRate, rationale);
  }

  const { usage } = proposal;
  return {
    ...session,
    patch: matches ? proposal.patch : undefined,
    modelNote: matches ? undefined : proposal.patch ? rejection : proposal.rationale,
    escalation: { ...session.escalation, available: true, used: true },
    flags: flags.all(),
    metrics: {
      ...session.metrics,
      calls: session.metrics.calls + 1,
      generativeTokens: session.metrics.generativeTokens + usage.promptTokens + usage.completionTokens,
      modelLatencyMs: session.metrics.modelLatencyMs + usage.latencyMs,
    },
  };
}

export function applySessionRepair(session: DiagnosticSession): DiagnosticSession {
  const flags = new FlagLog(session.flags);
  return trace(flags, "applySessionRepair", () => {
    if (!session.patch) throw new Error("No hay una reparación segura disponible para esta sesión.");
    const patchedSource = applyPatch(session.source, session.patch, flags);
    const checkers = runCheckers(patchedSource, session.diagnostic, flags);
    // Un modelo sólo puede modificar las líneas editables que recibió (no las de referencia).
    if (session.patch.origin === "model") {
      const { lines, readOnlyLines } = session.context;
      const editable = lines.filter((line) => !readOnlyLines.includes(line));
      checkers.push(checkChangesWithinContext(session.source, patchedSource, editable));
    }
    const verified = checkers.every((checker) => checker.passed);
    return {
      ...session,
      status: verified ? "verified" : "failed",
      patchedSource,
      checkers,
      flags: flags.all(),
    };
  });
}

/** Código que debe quedar en el editor: sólo cambia si el patch pasó todos los checkers. */
export function codeAfterRepair(session: DiagnosticSession, currentCode: string): string {
  return session.status === "verified" && session.patchedSource !== undefined ? session.patchedSource : currentCode;
}
