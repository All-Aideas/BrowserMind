import { FlagLog, trace, traceAsync } from "./flags";
import { classifyError, selectContext } from "./diagnostics";
import { planEscalation, type ModelAdapter } from "./escalation";
import { applyPatch, proposeRepair } from "./patches";
import { checkChangesWithinContext, runCheckers } from "./checkers";
import { parsePython } from "./parser";
import type { DiagnosticSession } from "./types";

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

  // Un fragmento que no está en el código no se puede aplicar ni auditar: se descarta.
  const matches = proposal.patch !== undefined && session.source.includes(proposal.patch.before);
  if (proposal.patch && !matches) {
    flags.add({
      functionName: "escalateToModel",
      phase: "error",
      level: "error",
      message: "Patch descartado: el fragmento `before` no aparece en el código.",
      details: proposal.patch.before,
    });
  }

  const { usage } = proposal;
  return {
    ...session,
    patch: matches ? proposal.patch : undefined,
    modelNote: matches ? undefined : proposal.patch ? "El patch generado no coincide con el código y se descartó." : proposal.rationale,
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
    // Un modelo sólo vio el contexto enviado: no puede haber modificado otras líneas.
    if (session.patch.origin === "model") {
      checkers.push(checkChangesWithinContext(session.source, patchedSource, session.context.lines));
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
