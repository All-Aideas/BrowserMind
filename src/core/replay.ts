/**
 * Modo replay (T7): graba las respuestas reales de un endpoint compatible con OpenAI y las
 * reproduce sin red ni key. Envuelve `fetch`, así que sirve para cualquier adaptador
 * (GlimmerAdapter, MetaModelApiAdapter) sin modificarlo.
 *
 * La clave de cada grabación es un hash de `model` + `messages`: si el contexto que se
 * enviaría cambia, el replay no responde con una grabación vieja sino con un 404 explícito.
 * Cada grabación guarda el pedido completo (ya redactado) para mostrar qué viajó.
 */
export interface ReplayRecord {
  key: string;
  /** `recorded` = respuesta real del endpoint; `synthetic` = escrita a mano para tests o demo. */
  source: "recorded" | "synthetic";
  model: string;
  recordedAt: string;
  latencyMs: number;
  request: { model: string; messages: Array<{ role: string; content: string }> };
  status: number;
  response: unknown;
}

export interface ReplayFile {
  version: 1;
  records: ReplayRecord[];
}

interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

/** FNV-1a de 32 bits: determinista, sin dependencias, suficiente para indexar grabaciones. */
export function replayKey(request: ChatRequest): string {
  const text = JSON.stringify({ model: request.model, messages: request.messages });
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${request.model}:${(hash >>> 0).toString(16).padStart(8, "0")}:${text.length}`;
}

function parseRequest(init?: RequestInit): ChatRequest {
  const body = JSON.parse(String(init?.body ?? "{}")) as Partial<ChatRequest>;
  return { model: body.model ?? "", messages: body.messages ?? [] };
}

/** `fetch` que delega en `inner` y agrega a `sink` cada respuesta exitosa. */
export function recordingFetch(inner: typeof fetch, sink: ReplayRecord[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = parseRequest(init);
    const startedAt = performance.now();
    const response = await inner(input, init);
    if (!response.ok) return response;
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return new Response(text, { status: response.status, headers: response.headers });
    }
    sink.push({
      key: replayKey(request),
      source: "recorded",
      model: request.model,
      recordedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
      request,
      status: response.status,
      response: parsed,
    });
    return new Response(text, { status: response.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

/** `fetch` que responde sólo desde grabaciones. Sin coincidencia devuelve 404 con el motivo. */
export function replayFetch(records: readonly ReplayRecord[], options: { simulateLatency?: boolean } = {}): typeof fetch {
  const byKey = new Map(records.map((record) => [record.key, record]));
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const key = replayKey(parseRequest(init));
    const record = byKey.get(key);
    if (!record) {
      return new Response(`Replay: no hay grabación para este contexto (${key}).`, { status: 404 });
    }
    if (options.simulateLatency && record.latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, record.latencyMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Replay cancelado.", "AbortError"));
        }, { once: true });
      });
    }
    return new Response(JSON.stringify(record.response), {
      status: record.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

export function toReplayFile(records: readonly ReplayRecord[]): ReplayFile {
  return { version: 1, records: [...records] };
}

/** Valida un archivo de replay cargado (por ejemplo, desde `/replays/*.json`). */
export function parseReplayFile(json: unknown): ReplayRecord[] {
  const file = json as Partial<ReplayFile> | null;
  if (!file || file.version !== 1 || !Array.isArray(file.records)) {
    throw new Error("Archivo de replay inválido: se esperaba { version: 1, records: [...] }.");
  }
  return file.records.filter((record): record is ReplayRecord =>
    typeof record?.key === "string" && typeof record.model === "string" && record.response !== undefined);
}
