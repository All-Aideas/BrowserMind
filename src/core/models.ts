import type { ModelAdapter } from "./escalation";
import { GLIMMER_PROXY_ENDPOINT, GlimmerAdapter } from "./glimmer";
import type { ModelHarness } from "./harness";
import { MetaModelApiAdapter } from "./metaModelApi";
import { parseReplayFile, replayFetch } from "./replay";
import type { EscalationLevel } from "./types";

/**
 * Arma los adaptadores de modelo para la UI en un solo lugar.
 *
 * - `live`: Muse Spark por el proxy /api/meta (nivel 3) y Glimmer (nivel 2) si está configurado.
 * - `replay`: las mismas llamadas, servidas desde /replays/muse-spark.json, sin red ni key.
 *
 * Sin Glimmer, Spark atiende también el nivel 2 como respaldo explícito: el nombre del
 * modelo lo dice, para que la UI y el harness no lo presenten como Glimmer.
 */
export type ModelMode = "live" | "replay";

export interface ModelSetupOptions {
  mode?: ModelMode;
  /** Incluir Glimmer (nivel 2). Por defecto, VITE_GLIMMER_ENABLED === "true". */
  glimmer?: boolean;
  replayUrl?: string;
  fetchImpl?: typeof fetch;
  harness?: ModelHarness;
}

export interface ModelSetup {
  mode: ModelMode;
  adapters: ModelAdapter[];
  notes: string[];
}

export const REPLAY_URL = "/replays/muse-spark.json";
export const FALLBACK_SUFFIX = " · respaldo de nivel 2";

/** Expone un adaptador en otro nivel sin cambiar qué modelo responde. */
export function withLevel(adapter: ModelAdapter, level: Exclude<EscalationLevel, 0>, suffix = FALLBACK_SUFFIX): ModelAdapter {
  return {
    level,
    model: `${adapter.model}${suffix}`,
    proposePatch: (context, diagnostic, signal) => adapter.proposePatch(context, diagnostic, signal),
  };
}

export function adapterForLevel(adapters: readonly ModelAdapter[], level: EscalationLevel): ModelAdapter | undefined {
  return adapters.find((adapter) => adapter.level === level);
}

/** `?replay` en la URL o VITE_MODEL_MODE=replay activan el modo replay. */
export function modeFromLocation(search: string, envMode = import.meta.env.VITE_MODEL_MODE): ModelMode {
  return new URLSearchParams(search).has("replay") || envMode === "replay" ? "replay" : "live";
}

export async function createModelAdapters(options: ModelSetupOptions = {}): Promise<ModelSetup> {
  const mode = options.mode ?? "live";
  const baseFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const notes: string[] = [];
  let fetchImpl: typeof fetch = baseFetch;

  if (mode === "replay") {
    try {
      const response = await baseFetch(options.replayUrl ?? REPLAY_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const records = parseReplayFile(await response.json());
      fetchImpl = replayFetch(records, { simulateLatency: true });
      notes.push(`Replay: ${records.length} respuestas grabadas; no se llama a ningún endpoint.`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { mode, adapters: [], notes: [`Replay no disponible (${reason}): sólo reglas locales.`] };
    }
  }

  const spark = new MetaModelApiAdapter({ fetchImpl, harness: options.harness });
  const adapters: ModelAdapter[] = [spark];
  const glimmerEnabled = options.glimmer ?? import.meta.env.VITE_GLIMMER_ENABLED === "true";
  if (glimmerEnabled && mode === "live") {
    adapters.unshift(new GlimmerAdapter({
      endpoint: GLIMMER_PROXY_ENDPOINT,
      model: import.meta.env.VITE_GLIMMER_MODEL || "muse-glimmer",
      fetchImpl,
      harness: options.harness,
    }));
  } else {
    adapters.unshift(withLevel(spark, 2));
    notes.push("Sin Glimmer: Muse Spark atiende el nivel 2 como respaldo.");
  }
  return { mode, adapters, notes };
}
