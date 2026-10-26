import type { ModelAdapter, ModelProposal } from "./escalation";
import { ModelHarness } from "./harness";
import type { Diagnostic, SelectedContext } from "./types";

/**
 * Adaptador de nivel 2 para Muse Glimmer sobre cualquier endpoint compatible con
 * OpenAI Chat Completions (vLLM o SGLang propio, Together, NVIDIA, etc.).
 *
 * La API key nunca llega al navegador: el endpoint por defecto es el proxy de Vite
 * (`/api/glimmer`), que agrega el header Authorization del lado del servidor.
 */
export interface GlimmerConfig {
  endpoint: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  harness?: ModelHarness;
}

export const GLIMMER_PROXY_ENDPOINT = "/api/glimmer/chat/completions";

const SYSTEM_PROMPT = [
  "Reparás errores de scripts de Python para data science.",
  "Recibís sólo un fragmento de código con líneas numeradas y el error.",
  'Respondé únicamente con JSON: {"before": "...", "after": "...", "explanation": "..."}.',
  "`before` debe copiarse textualmente de una línea recibida, sin el prefijo de número de línea; `after` lo reemplaza.",
  "Hacé el cambio mínimo. No inventes columnas ni variables que no aparezcan en el fragmento.",
  "Las líneas bajo «# definiciones (sólo lectura)» son referencia: no las modifiques.",
  "`before` tiene que ser único en el código: incluí suficiente texto de la línea para que no se repita.",
  'Si no hay un cambio seguro, respondé {"before": "", "after": "", "explanation": "<motivo>"}.',
].join("\n");

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface GeneratedPatch {
  before: string;
  after: string;
  explanation: string;
}

export function buildMessages(context: SelectedContext, diagnostic: Diagnostic) {
  const user = [
    `Tipo de error: ${diagnostic.kind} — ${diagnostic.title}`,
    diagnostic.summary,
    `Paso sugerido: ${diagnostic.nextStep}`,
    "",
    "Contexto:",
    context.payload,
  ].join("\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

const LINE_PREFIX = /^\s*\d+:\s?/gm;

/** Extrae el JSON aunque el modelo lo envuelva en un bloque ```json o agregue texto. */
export function parseGeneratedPatch(content: string): GeneratedPatch {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("La respuesta de Glimmer no contiene JSON.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new Error("La respuesta de Glimmer tiene JSON inválido.");
  }
  const { before, after, explanation } = (parsed ?? {}) as Record<string, unknown>;
  if (typeof before !== "string" || typeof after !== "string") {
    throw new Error("La respuesta de Glimmer no trae `before` y `after` como texto.");
  }
  return {
    before: before.replace(LINE_PREFIX, ""),
    after: after.replace(LINE_PREFIX, ""),
    explanation: typeof explanation === "string" ? explanation : "",
  };
}

export class GlimmerAdapter implements ModelAdapter {
  readonly level = 2 as const;
  readonly model: string;
  private readonly config: Required<Omit<GlimmerConfig, "fetchImpl">> & { fetchImpl: typeof fetch };

  constructor(config: GlimmerConfig) {
    this.model = config.model;
    this.config = {
      maxTokens: 512,
      timeoutMs: 30_000,
      ...config,
      fetchImpl: config.fetchImpl ?? ((...args) => fetch(...args)),
      harness: config.harness ?? new ModelHarness(),
    };
  }

  async proposePatch(context: SelectedContext, diagnostic: Diagnostic, signal?: AbortSignal): Promise<ModelProposal> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await this.config.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: buildMessages(context, diagnostic),
          max_tokens: this.config.maxTokens,
          temperature: 0,
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      const reason = timeout.aborted
        ? new Error(`Glimmer no respondió en ${this.config.timeoutMs / 1000} s.`)
        : error instanceof Error && error.name === "AbortError"
          ? new Error("Escalamiento cancelado.")
          : new Error(`No se pudo conectar con Glimmer en ${this.config.endpoint}.`);
      this.config.harness.recordFailure(this.model, this.level, {
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Math.round(performance.now() - startedAt),
      }, reason.message);
      throw reason;
    }

    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      const reason = `Glimmer respondió ${response.status}${body ? `: ${body}` : ""}`;
      this.config.harness.recordFailure(this.model, this.level, {
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Math.round(performance.now() - startedAt),
      }, reason);
      throw new Error(reason);
    }

    const latencyMs = Math.round(performance.now() - startedAt);
    let completion: ChatCompletion;
    try {
      completion = (await response.json()) as ChatCompletion;
    } catch {
      const reason = "Glimmer devolvió una respuesta que no es JSON válido.";
      this.config.harness.recordFailure(this.model, this.level, {
        promptTokens: 0,
        completionTokens: 0,
        latencyMs,
      }, reason);
      throw new Error(reason);
    }
    const usage = {
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      latencyMs,
    };
    let generated: GeneratedPatch;
    try {
      generated = parseGeneratedPatch(completion.choices?.[0]?.message?.content ?? "");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Respuesta de Glimmer inválida.";
      this.config.harness.record({
        model: this.model,
        level: this.level,
        ...usage,
        status: "failed",
        error: reason,
      });
      throw new Error(reason);
    }
    const rationale = generated.explanation || "Sin explicación del modelo.";

    if (!generated.before.trim() || generated.before === generated.after) {
      this.config.harness.record({
        model: this.model,
        level: this.level,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        latencyMs: usage.latencyMs,
        status: "empty",
        rationale,
      });
      return { rationale, usage };
    }
    const proposal: ModelProposal = {
      rationale,
      usage,
      patch: {
        id: "glimmer-patch",
        title: "Patch generado por Muse Glimmer",
        explanation: rationale,
        mode: "replace",
        before: generated.before,
        after: generated.after,
        changedLine: diagnostic.line,
        safety: "guarded",
        origin: "model",
      },
    };
    this.config.harness.record({
      model: this.model,
      level: this.level,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      latencyMs: usage.latencyMs,
      status: "received",
      rationale,
    });
    return proposal;
  }
}
