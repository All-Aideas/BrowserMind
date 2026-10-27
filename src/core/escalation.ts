import { traced, type FlagTarget } from "./flags";
import type { ModelHarness } from "./harness";
import type { Diagnostic, EscalationLevel, EscalationPlan, RepairPatch, SelectedContext } from "./types";

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

export interface ModelProposal {
  /** Ausente cuando el modelo declara que no tiene un cambio seguro. */
  patch?: RepairPatch;
  rationale: string;
  usage: ModelUsage;
}

/**
 * Contrato para conectar un modelo de Meta. Recibe exclusivamente el contexto
 * seleccionado y redactado: nunca el código completo ni filas del dataset.
 */
export interface ModelAdapter {
  readonly level: Exclude<EscalationLevel, 0>;
  readonly model: string;
  /** Harness compartido para cerrar la llamada después de los checkers. */
  readonly harness?: ModelHarness;
  proposePatch(context: SelectedContext, diagnostic: Diagnostic, signal?: AbortSignal): Promise<ModelProposal>;
}

export const MODEL_BY_LEVEL: Record<EscalationLevel, string> = {
  0: "Reglas locales",
  1: "Modelo pequeño de Meta",
  2: "Muse Glimmer",
  3: "Muse Spark",
};

const LOW_CONFIDENCE = 0.5;

export function planEscalation(
  diagnostic: Diagnostic,
  patch: RepairPatch | undefined,
  adapters: readonly ModelAdapter[] = [],
  sink?: FlagTarget,
): EscalationPlan {
  return traced(sink, "planEscalation", () => {
    let level: EscalationLevel;
    let reason: string;
    if (patch) {
      level = 0;
      reason = "Las reglas locales encontraron una reparación verificable; no hace falta generar código.";
    } else if (diagnostic.confidence < LOW_CONFIDENCE) {
      level = 3;
      reason = "La confianza de la clasificación es baja: corresponde la referencia de alta capacidad.";
    } else {
      level = 2;
      reason = "El error está clasificado pero no hay plantilla segura: corresponde generar un patch.";
    }
    const available = level === 0 || adapters.some((adapter) => adapter.level === level);
    return { level, model: MODEL_BY_LEVEL[level], reason, available };
  });
}
