import { describe, expect, it, vi } from "vitest";
import { PythonRuntime, type WorkerLike } from "./pythonRuntime";

function fakeWorker(): WorkerLike {
  return {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
}

describe("PythonRuntime", () => {
  it("resuelve el resultado del worker y lo termina", async () => {
    const worker = fakeWorker();
    const runtime = new PythonRuntime(() => worker);
    const promise = runtime.run({ code: "print('ok')" });

    worker.onmessage?.({
      data: {
        type: "result",
        id: "python-1",
        result: {
          status: "success",
          stdout: "ok\n",
          stderr: "",
          traceback: "",
          durationMs: 4,
          packagesLoaded: [],
        },
      },
    } as MessageEvent);

    await expect(promise).resolves.toMatchObject({ status: "success", stdout: "ok\n" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("distingue un error del worker", async () => {
    const worker = fakeWorker();
    const flags: string[] = [];
    const promise = new PythonRuntime(() => worker).run({ code: "raise ValueError()" }, (flag) => {
      flags.push(`${flag.phase}:${flag.level}`);
    });
    worker.onerror?.({ message: "ValueError: bad value" } as ErrorEvent);

    await expect(promise).resolves.toMatchObject({
      status: "error",
      traceback: "ValueError: bad value",
    });
    expect(flags).toEqual(["start:info", "error:error"]);
  });

  it("devuelve timeout sin dejar una promesa colgada", async () => {
    vi.useFakeTimers();
    const worker = fakeWorker();
    const promise = new PythonRuntime(() => worker).run({ code: "while True: pass", timeoutMs: 20 });
    vi.advanceTimersByTime(20);

    await expect(promise).resolves.toMatchObject({ status: "timeout" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("informa cuando no puede crear el worker", async () => {
    const result = await new PythonRuntime(() => {
      throw new Error("Worker bloqueado por el navegador");
    }).run({ code: "print(1)" });

    expect(result).toMatchObject({ status: "unavailable", error: "Worker bloqueado por el navegador" });
  });
});
