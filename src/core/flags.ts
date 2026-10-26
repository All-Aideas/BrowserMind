import type { FlagSink, FunctionFlag } from "./types";

export type { FlagSink } from "./types";

let sequence = 0;

export class FlagLog {
  private readonly items: FunctionFlag[];

  constructor(initial: readonly FunctionFlag[] = []) {
    // Conserva id y timestamp originales para no reescribir la historia de la sesión.
    this.items = [...initial];
  }

  add(flag: Omit<FunctionFlag, "id" | "timestamp">): void {
    this.items.push({
      ...flag,
      id: `flag-${++sequence}`,
      timestamp: new Date().toISOString(),
    });
  }

  all(): FunctionFlag[] {
    return [...this.items];
  }
}

export type FlagTarget = FlagLog | FlagSink;

export function trace<T>(flags: FlagLog, functionName: string, work: () => T): T {
  const startedAt = performance.now();
  flags.add({
    functionName,
    phase: "start",
    level: "info",
    message: `Inicia ${functionName}`,
  });

  try {
    const result = work();
    flags.add({
      functionName,
      phase: "success",
      level: "success",
      durationMs: Math.round(performance.now() - startedAt),
      message: `Finaliza ${functionName} correctamente`,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    flags.add({
      functionName,
      phase: "error",
      level: "error",
      durationMs: Math.round(performance.now() - startedAt),
      message: `Falla ${functionName}: ${message}`,
      details: "Revisá el evento anterior para ubicar el contexto que provocó el error.",
    });
    throw error;
  }
}

/** Variante de `trace` para trabajo asíncrono (llamadas a modelos remotos). */
export async function traceAsync<T>(flags: FlagLog, functionName: string, work: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  flags.add({ functionName, phase: "start", level: "info", message: `Inicia ${functionName}` });
  try {
    const result = await work();
    flags.add({
      functionName,
      phase: "success",
      level: "success",
      durationMs: Math.round(performance.now() - startedAt),
      message: `Finaliza ${functionName} correctamente`,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    flags.add({
      functionName,
      phase: "error",
      level: "error",
      durationMs: Math.round(performance.now() - startedAt),
      message: `Falla ${functionName}: ${message}`,
      details: "Revisá que el endpoint esté levantado y la configuración en .env.local.",
    });
    throw error;
  }
}

/**
 * Ejecuta `work` con trazabilidad sobre cualquier destino: un FlagLog compartido,
 * un sink externo (que recibe los flags también cuando la función falla) o ninguno.
 */
export function traced<T>(target: FlagTarget | undefined, functionName: string, work: () => T): T {
  if (target instanceof FlagLog) return trace(target, functionName, work);
  const log = new FlagLog();
  try {
    return trace(log, functionName, work);
  } finally {
    if (target) log.all().forEach(target);
  }
}
