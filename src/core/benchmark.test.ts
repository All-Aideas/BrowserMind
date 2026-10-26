import { describe, expect, it } from "vitest";
import { runProductBenchmark } from "./benchmark";

describe("benchmark reproducible A-D", () => {
  it("ejecuta 20 tareas y no cuenta configuraciones sin modelo", () => {
    const report = runProductBenchmark();
    expect(report).toMatchObject({ total: 20, attempted: 10, notConfigured: 10, resolved: 6 });
    expect(report.summaries).toEqual([
      expect.objectContaining({ config: "A", attempted: 5, resolved: 3, notConfigured: 0 }),
      expect.objectContaining({ config: "B", attempted: 5, resolved: 3, notConfigured: 0 }),
      expect.objectContaining({ config: "C", attempted: 0, resolved: 0, notConfigured: 5 }),
      expect.objectContaining({ config: "D", attempted: 0, resolved: 0, notConfigured: 5 }),
    ]);
  });

  it("explica cada tarea manual y cada modelo no configurado", () => {
    const report = runProductBenchmark();
    expect(report.tasks.find((task) => task.id === "A-shape-mismatch")).toMatchObject({ status: "manual-review" });
    expect(report.tasks.find((task) => task.id === "C-merge-alignment")).toMatchObject({ status: "not-configured", totalTokens: 0 });
    expect(report.tasks.every((task) => task.message.length > 0)).toBe(true);
  });
});
