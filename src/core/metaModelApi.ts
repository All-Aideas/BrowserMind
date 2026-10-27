import type { ModelAdapter, ModelProposal } from "./escalation";
import { buildMessages } from "./glimmer";
import { ModelHarness } from "./harness";
import type { Diagnostic, SelectedContext } from "./types";

/**
 * Adaptador de nivel 3 para Muse Spark servido por Meta Model API
 * (`https://api.meta.ai/v1`, compatible con OpenAI Chat Completions).
 *
 * La API key nunca llega al navegador: el endpoint por defecto es el proxy de Vite
 * (`/api/meta`), que agrega `Authorization: Bearer MODEL_API_KEY` del lado del servidor.
 *
 * Deuda: el parseo y el manejo de errores duplican a `GlimmerAdapter` (glimmer.ts está en
 * manos de B en T4). Unificar en un adaptador OpenAI genérico cuando ambos estén en main.
 */
export interface MetaModelApiConfig {
  endpoint?: string;
  model?: string;
  /** Muse Spark siempre razona y esos tokens cuentan contra `max_tokens`: 512 queda corto. */
  maxTokens?: number;
  timeoutMs?: number;
  /** `response_format` con `json_schema` (decodificación restringida, documentada por Meta). */
  structuredOutput?: boolean;
  fetchImpl?: typeof fetch;
  harness?: ModelHarness;
}

export const META_PROXY_ENDPOINT = "/api/meta/chat/completions";
export const DEFAULT_META_MODEL = "muse-spark-1.3";

const PATCH_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "repair_patch",
    strict: true,
    schema: {
      type: "object",
      properties: {
        before: { type: "string" },
        after: { type: "string" },
        explanation: { type: "string" },
      },
      required: ["before", "after", "explanation"],
      additionalProperties: false,
    },
  },
} as const;

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

interface GeneratedPatch {
  before: string;
  after: string;
  explanation: string;
}

const LINE_PREFIX = /^\s*\d+:\s?/gm;

/** Extrae el JSON aunque el modelo lo envuelva en un bloque ```json o agregue texto. */
export function parseSparkPatch(content: string): GeneratedPatch {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("La respuesta de Muse Spark no contiene JSON.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new Error("La respuesta de Muse Spark tiene JSON inválido.");
  }
  const { before, after, explanation } = (parsed ?? {}) as Record<string, unknown>;
  if (typeof before !== "string" || typeof after !== "string") {
    throw new Error("La respuesta de Muse Spark no trae `before` y `after` como texto.");
  }
  return {
    before: before.replace(LINE_PREFIX, ""),
    after: after.replace(LINE_PREFIX, ""),
    explanation: typeof explanation === "string" ? explanation : "",
  };
}

function defaultModel(): string {
  return import.meta.env.VITE_META_MODEL || DEFAULT_META_MODEL;
}

export class MetaModelApiAdapter implements ModelAdapter {
  readonly level = 3 as const;
  readonly model: string;
  /** Harness compartido: escalateSession registra la propuesta y la cierra tras los checkers. */
  readonly harness: ModelHarness;
  /** Tokens de razonamiento de la última llamada (`usage.completion_tokens_details`). */
  lastReasoningTokens = 0;
  private readonly config: Required<Omit<MetaModelApiConfig, "fetchImpl">> & { fetchImpl: typeof fetch };

  constructor(config: MetaModelApiConfig = {}) {
    this.model = config.model ?? defaultModel();
    this.harness = config.harness ?? new ModelHarness();
    this.config = {
      endpoint: META_PROXY_ENDPOINT,
      maxTokens: 2048,
      timeoutMs: 60_000,
      structuredOutput: true,
      ...config,
      model: this.model,
      fetchImpl: config.fetchImpl ?? ((...args) => fetch(...args)),
      harness: this.harness,
    };
  }

  private fail(reason: string, latencyMs: number): Error {
    this.config.harness.recordFailure(this.model, this.level, { promptTokens: 0, completionTokens: 0, latencyMs }, reason);
    return new Error(reason);
  }

  async proposePatch(context: SelectedContext, diagnostic: Diagnostic, signal?: AbortSignal): Promise<ModelProposal> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    let response: Response;
    try {
      response = await this.config.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: buildMessages(context, diagnostic),
          max_tokens: this.config.maxTokens,
          temperature: 0,
          ...(this.config.structuredOutput ? { response_format: PATCH_SCHEMA } : {}),
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      throw this.fail(
        timeout.aborted
          ? `Muse Spark no respondió en ${this.config.timeoutMs / 1000} s.`
          : error instanceof Error && error.name === "AbortError"
            ? "Escalamiento cancelado."
            : `No se pudo conectar con Meta Model API en ${this.config.endpoint}.`,
        elapsed(),
      );
    }

    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      throw this.fail(`Meta Model API respondió ${response.status}${body ? `: ${body}` : ""}`, elapsed());
    }

    const latencyMs = elapsed();
    let completion: ChatCompletion;
    try {
      completion = (await response.json()) as ChatCompletion;
    } catch {
      throw this.fail("Meta Model API devolvió una respuesta que no es JSON válido.", latencyMs);
    }
    const usage = {
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      latencyMs,
    };
    this.lastReasoningTokens = completion.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

    let generated: GeneratedPatch;
    try {
      generated = parseSparkPatch(completion.choices?.[0]?.message?.content ?? "");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Respuesta de Muse Spark inválida.";
      this.config.harness.record({ model: this.model, level: this.level, ...usage, status: "failed", error: reason });
      throw new Error(reason);
    }
    const rationale = generated.explanation || "Sin explicación del modelo.";

    if (!generated.before.trim() || generated.before === generated.after) {
      this.config.harness.record({ model: this.model, level: this.level, ...usage, status: "empty", rationale });
      return { rationale, usage };
    }
    // El registro de la propuesta (received → accepted/rejected) lo hace escalateSession.
    return {
      rationale,
      usage,
      patch: {
        id: "spark-patch",
        title: "Patch generado por Muse Spark",
        explanation: rationale,
        mode: "replace",
        before: generated.before,
        after: generated.after,
        changedLine: diagnostic.line,
        safety: "guarded",
        origin: "model",
      },
    };
  }
}
