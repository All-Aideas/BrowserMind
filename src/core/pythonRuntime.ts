import { FlagLog, type FlagSink } from "./flags";

export type PythonExecutionStatus = "success" | "error" | "timeout" | "unavailable";

export interface PythonExecutionRequest {
  code: string;
  timeoutMs?: number;
}

export interface PythonExecutionResult {
  status: PythonExecutionStatus;
  stdout: string;
  stderr: string;
  traceback: string;
  durationMs: number;
  packagesLoaded: string[];
  error?: string;
}

export interface PythonWorkerRequest {
  type: "run";
  id: string;
  code: string;
}

export interface PythonWorkerResponse {
  type: "result";
  id: string;
  result: PythonExecutionResult;
}

export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export type WorkerFactory = () => WorkerLike;

let nextExecutionId = 1;

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function unavailableResult(startedAt: number, error: unknown): PythonExecutionResult {
  const message = error instanceof Error ? error.message : "Web Worker no disponible.";
  return {
    status: "unavailable",
    stdout: "",
    stderr: "",
    traceback: "",
    durationMs: elapsedSince(startedAt),
    packagesLoaded: [],
    error: message,
  };
}

export class PythonRuntime {
  public constructor(private readonly factory: WorkerFactory) {}

  public run(request: PythonExecutionRequest, sink?: FlagSink): Promise<PythonExecutionResult> {
    const startedAt = performance.now();
    const timeoutMs = Math.max(1, request.timeoutMs ?? 30_000);
    const flags = new FlagLog();
    const publish = (phase: "start" | "success" | "error", level: "info" | "success" | "error", message: string): void => {
      if (!sink) return;
      flags.add({ functionName: "PythonRuntime.run", phase, level, message, durationMs: phase === "start" ? undefined : Math.round(performance.now() - startedAt) });
      const latest = flags.all().at(-1);
      if (latest) sink(latest);
    };
    publish("start", "info", "Inicia PythonRuntime.run");
    let worker: WorkerLike;
    try {
      worker = this.factory();
    } catch (error) {
      const result = unavailableResult(startedAt, error);
      publish("error", "error", `Falla PythonRuntime.run: ${result.error ?? "worker no disponible"}`);
      return Promise.resolve(result);
    }

    const id = `python-${nextExecutionId++}`;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: PythonExecutionResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        publish(result.status === "success" ? "success" : "error", result.status === "success" ? "success" : "error", result.status === "success"
          ? "Finaliza PythonRuntime.run correctamente"
          : `Falla PythonRuntime.run: ${result.error ?? result.traceback ?? result.status}`);
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({
          status: "timeout",
          stdout: "",
          stderr: "",
          traceback: "La ejecución superó el tiempo máximo permitido.",
          durationMs: elapsedSince(startedAt),
          packagesLoaded: [],
          error: `Timeout después de ${timeoutMs}ms.`,
        });
      }, timeoutMs);

      worker.onmessage = (event) => {
        const message = event.data as Partial<PythonWorkerResponse> | undefined;
        if (!message || message.type !== "result" || message.id !== id || !message.result) return;
        finish({ ...message.result, durationMs: message.result.durationMs || elapsedSince(startedAt) });
      };
      worker.onerror = (event) => {
        finish({
          status: "error",
          stdout: "",
          stderr: event.message || "El Web Worker informó un error.",
          traceback: event.message || "",
          durationMs: elapsedSince(startedAt),
          packagesLoaded: [],
          error: event.message || "Falló el Web Worker.",
        });
      };

      const message: PythonWorkerRequest = { type: "run", id, code: request.code };
      try {
        worker.postMessage(message);
      } catch (error) {
        finish(unavailableResult(startedAt, error));
      }
    });
  }

  public dispose(): void {
    // Cada ejecución crea y termina su propio worker; no hay estado compartido que limpiar.
  }
}

export function createBrowserPythonRuntime(): PythonRuntime {
  return new PythonRuntime(() => new Worker(
    new URL("../runtime/python.worker.ts", import.meta.url),
    { type: "module" },
  ));
}
