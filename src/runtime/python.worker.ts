import type { PythonExecutionResult, PythonWorkerRequest, PythonWorkerResponse } from "../core/pythonRuntime";

// La versión queda fija para que una actualización del CDN no cambie la demo sin revisión.
const PYODIDE_VERSION = "0.26.4";
const PYODIDE_MODULE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`;
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

interface PyodideRuntime {
  loadPackagesFromImports(code: string): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  setStdout(options: { batched: (text: string) => void }): void;
  setStderr(options: { batched: (text: string) => void }): void;
}

interface PyodideModule {
  loadPyodide(options: { indexURL: string }): Promise<PyodideRuntime>;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<PythonWorkerRequest>) => void) | null;
  postMessage(message: PythonWorkerResponse): void;
}

const workerScope = globalThis as unknown as WorkerScope;
let pyodidePromise: Promise<PyodideRuntime> | undefined;

function loadPyodideRuntime(): Promise<PyodideRuntime> {
  pyodidePromise ??= import(/* @vite-ignore */ PYODIDE_MODULE_URL)
    .then((module) => (module as PyodideModule).loadPyodide({ indexURL: PYODIDE_INDEX_URL }));
  return pyodidePromise;
}

function importedPackages(code: string): string[] {
  const packages = new Set<string>();
  for (const match of code.matchAll(/^\s*(?:from|import)\s+([a-zA-Z_][\w.]*)/gm)) {
    const root = match[1]?.split(".")[0];
    if (root) packages.add(root);
  }
  return [...packages];
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

async function execute(request: PythonWorkerRequest): Promise<PythonExecutionResult> {
  const startedAt = performance.now();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const packagesLoaded = importedPackages(request.code);

  let pyodide: PyodideRuntime;
  try {
    pyodide = await loadPyodideRuntime();
  } catch (error) {
    const message = errorText(error);
    return {
      status: "unavailable",
      stdout: "",
      stderr: message,
      traceback: "",
      durationMs: Math.round(performance.now() - startedAt),
      packagesLoaded,
      error: `No se pudo cargar Pyodide: ${message}`,
    };
  }

  try {
    pyodide.setStdout({ batched: (text) => stdout.push(text) });
    pyodide.setStderr({ batched: (text) => stderr.push(text) });
    await pyodide.loadPackagesFromImports(request.code);
    await pyodide.runPythonAsync(request.code);
    return {
      status: "success",
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      traceback: "",
      durationMs: Math.round(performance.now() - startedAt),
      packagesLoaded,
    };
  } catch (error) {
    const traceback = errorText(error);
    return {
      status: "error",
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      traceback,
      durationMs: Math.round(performance.now() - startedAt),
      packagesLoaded,
      error: traceback,
    };
  }
}

workerScope.onmessage = async (event) => {
  const request = event.data;
  if (!request || request.type !== "run") return;
  const result = await execute(request);
  workerScope.postMessage({ type: "result", id: request.id, result });
};
