import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BOARD_PATH,
  claimTask,
  conflictsFor,
  makeMessage,
  mergeMessages,
  nextId,
  openQuestions,
  parseArgs,
  renderStatus,
  sameArea,
  setTaskStatus,
} from "./agents.mjs";

const NOW = "2026-10-26T03:00:00.000Z";

function board() {
  return {
    goal: "test",
    tasks: [
      { id: "T1", priority: "P0", title: "Pyodide", why: "criterio 1", files: ["src/workers/", "src/App.tsx"], status: "todo", owner: null },
      { id: "T2", priority: "P0", title: "Spark", why: "modelo real", files: ["src/core/glimmer.ts", "src/App.tsx"], status: "todo", owner: null },
    ],
  };
}

describe("canal entre agentes", () => {
  it("el tablero versionado es JSON válido y cada tarea explica su porqué", () => {
    const real = JSON.parse(readFileSync(BOARD_PATH, "utf8"));
    expect(real.tasks.length).toBeGreaterThan(0);
    for (const task of real.tasks) expect(task.why).toBeTruthy();
  });

  it("parsea posicionales y flags", () => {
    expect(parseArgs(["claim", "T1", "--as", "A", "--why", "porque sí", "--dry"])).toEqual({
      positional: ["claim", "T1"],
      flags: { as: "A", why: "porque sí", dry: true },
    });
  });

  it("claim exige el porqué y no deja tomar una tarea ajena en curso", () => {
    const b = board();
    expect(() => claimTask(b, "T1", "A", "", NOW)).toThrow(/--why/);
    claimTask(b, "T1", "A", "criterio 1 del PDF", NOW);
    expect(b.tasks[0]).toMatchObject({ status: "doing", owner: "A" });
    expect(() => claimTask(b, "T1", "B", "yo también", NOW)).toThrow(/ya la tiene el agente A/);
  });

  it("avisa cuando una tarea comparte archivos con otra en curso", () => {
    const b = board();
    claimTask(b, "T1", "A", "x", NOW);
    expect(claimTask(b, "T2", "B", "y", NOW)).toEqual(["src/App.tsx (T1, agente A)"]);
  });

  it("detecta cambios locales en archivos de tareas ajenas", () => {
    const b = board();
    claimTask(b, "T1", "A", "x", NOW);
    expect(conflictsFor(b, "B", ["src/workers/python.ts", "README.md"])).toEqual([{ file: "src/workers/python.ts", task: "T1", owner: "A" }]);
    expect(conflictsFor(b, "A", ["src/workers/python.ts"])).toEqual([]);
    expect(sameArea("src/core/", "src/core/engine.ts")).toBe(true);
    expect(sameArea("src/core/engine.ts", "src/core/engine.test.ts")).toBe(false);
  });

  it("sólo el dueño (o el usuario) cambia el estado de una tarea", () => {
    const b = board();
    claimTask(b, "T1", "A", "x", NOW);
    expect(() => setTaskStatus(b, "T1", "B", "done", NOW)).toThrow(/handoff/);
    expect(setTaskStatus(b, "T1", "user", "todo", NOW)).toMatchObject({ status: "todo", owner: null });
  });

  it("decisiones y handoffs llevan porqué; las preguntas respondidas desaparecen", () => {
    expect(() => makeMessage({ from: "A", type: "decision", text: "usamos X" }, NOW, "m1")).toThrow(/--why/);
    const question = makeMessage({ from: "A", to: "B", type: "question", text: "¿tomás T4?" }, NOW, "m1");
    expect(openQuestions([question], "B")).toHaveLength(1);
    expect(openQuestions([question], "A")).toHaveLength(0);
    const answer = { ...makeMessage({ from: "B", type: "answer", text: "sí" }, NOW, "m2"), replyTo: "m1" };
    expect(openQuestions([question, answer], "B")).toHaveLength(0);
  });

  it("el resumen muestra porqué, preguntas pendientes y conflictos en pocas líneas", () => {
    const b = board();
    claimTask(b, "T1", "A", "x", NOW);
    const question = makeMessage({ from: "A", to: "B", type: "question", text: "¿tomás T2?" }, NOW, "m1");
    const text = renderStatus(b, [question], "B", [{ file: "src/App.tsx", task: "T1", owner: "A" }]);
    expect(text).toContain("por qué: criterio 1");
    expect(text).toContain("? m1 de A: ¿tomás T2?");
    expect(text).toContain("! src/App.tsx → T1 (agente A)");
    expect(text.split("\n").length).toBeLessThan(40);
  });

  it("los ids no chocan entre agentes que escriben en máquinas distintas", () => {
    const legacy = [{ id: "m1", from: "A" }, { id: "m2", from: "B" }];
    expect(nextId(legacy, "A")).toBe("A2");
    expect(nextId(legacy, "B")).toBe("B2");
    expect(nextId([...legacy, { id: "A2", from: "A" }], "A")).toBe("A3");
  });

  it("une el canal local con el de otra rama sin duplicar y en orden", () => {
    const local = [{ id: "m1", ts: "2026-10-26T01:00:00Z" }, { id: "B1", ts: "2026-10-26T03:00:00Z" }];
    const cloud = [{ id: "m1", ts: "2026-10-26T01:00:00Z" }, { id: "A1", ts: "2026-10-26T02:00:00Z" }];
    expect(mergeMessages(local, cloud).map((m) => m.id)).toEqual(["m1", "A1", "B1"]);
  });

  it("conserva los dos mensajes si el mismo agente repitió un id en dos ramas", () => {
    const main = [{ id: "A21", ts: "2026-10-26T21:09:59Z", text: "arreglo" }];
    const branch = [{ id: "A21", ts: "2026-10-26T21:10:53Z", text: "entrega" }];
    expect(mergeMessages(main, branch).map((m) => m.text)).toEqual(["arreglo", "entrega"]);
  });
});
