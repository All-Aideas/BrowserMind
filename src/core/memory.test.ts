import { describe, expect, it } from "vitest";
import { createInMemoryBackend, BrowserMindMemory, MEMORY_LIMITS } from "./memory";

describe("memoria local versionada", () => {
  it("guarda y recupera fuente, sesión y benchmark por separado", async () => {
    const memory = new BrowserMindMemory(createInMemoryBackend());
    await memory.save({
      source: {
        selectedSampleId: "missing-column",
        benchmarkMode: false,
        code: "x = 1",
        traceback: "KeyError",
      },
      session: { session: undefined, productQa: undefined },
      benchmark: { report: undefined },
    });

    await expect(memory.load()).resolves.toMatchObject({
      source: { version: 1, selectedSampleId: "missing-column", code: "x = 1" },
      session: { version: 1 },
      benchmark: { version: 1 },
    });
  });

  it("borra todas las categorías sin dejar credenciales ni datos fuera del alcance", async () => {
    const memory = new BrowserMindMemory(createInMemoryBackend());
    await memory.save({
      source: { selectedSampleId: "custom", benchmarkMode: true, code: "secret = 1", traceback: "" },
    });
    await memory.clear();
    await expect(memory.load()).resolves.toEqual({ source: undefined, session: undefined, benchmark: undefined });
  });

  it("rechaza fuentes que superan el límite local", async () => {
    const memory = new BrowserMindMemory(createInMemoryBackend());
    await expect(memory.save({
      source: {
        selectedSampleId: "custom",
        benchmarkMode: false,
        code: "x".repeat(MEMORY_LIMITS.sourceChars + 1),
        traceback: "",
      },
    })).rejects.toThrow(/límite local/);
  });
});
