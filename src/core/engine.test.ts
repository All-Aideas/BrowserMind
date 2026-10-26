import { describe, expect, it } from "vitest";
import { applySessionRepair, runDiagnosticSession } from "./engine";
import { classifyError, redactSensitive, selectContext } from "./diagnostics";
import { planEscalation } from "./escalation";
import { applyPatch, proposeRepair } from "./patches";
import { runCheckers } from "./checkers";
import { parsePython } from "./parser";
import { FlagLog, traced } from "./flags";
import { SAMPLE_CASES } from "./samples";
import type { Diagnostic, FunctionFlag } from "./types";

const UNKNOWN: Diagnostic = {
  kind: "unknown",
  title: "unknown",
  summary: "unknown",
  evidence: "unknown",
  confidence: 0.1,
  repairable: false,
  nextStep: "manual",
};

function sample(id: string) {
  const found = SAMPLE_CASES.find((item) => item.id === id);
  if (!found) throw new Error(`Caso inexistente: ${id}`);
  return found;
}

describe("clasificación", () => {
  it("clasifica los cinco casos del benchmark semilla", () => {
    const kinds = SAMPLE_CASES.map((item) => runDiagnosticSession(item.code, item.traceback).diagnostic.kind);
    expect(kinds).toEqual(SAMPLE_CASES.map((item) => item.id));
  });

  it("prioriza el traceback sobre palabras del código", () => {
    const source = 'merged = a.merge(b, on="id")\ntotal = df["revenue"].sum()';
    const diagnostic = classifyError(source, "KeyError: 'revenue'");
    expect(diagnostic.kind).toBe("missing-column");
    expect(diagnostic.matchedIn).toBe("traceback");
    expect(diagnostic.line).toBe(2);
  });

  it("baja la confianza cuando la firma sólo aparece en el código", () => {
    const diagnostic = classifyError("x = df.merge(other)", "");
    expect(diagnostic.matchedIn).toBe("source");
    expect(diagnostic.confidence).toBeLessThan(0.9);
  });

  it("centra un error desconocido en la línea informada por el traceback", () => {
    const source = [
      "header = 0",
      "noise_1 = 1",
      "noise_2 = 2",
      "noise_3 = 3",
      "noise_4 = 4",
      "noise_5 = 5",
      "result = process(data)",
      "footer = 9",
    ].join("\n");
    const diagnostic = classifyError(source, 'File "pipeline.py", line 7\nRuntimeError: proveedor no disponible');
    expect(diagnostic.kind).toBe("unknown");
    expect(diagnostic.line).toBe(7);
    expect(selectContext(source, parsePython(source), diagnostic).payload).toContain("7: result = process(data)");
  });

  it("no marca como reparables los casos que requieren revisión manual", () => {
    expect(runDiagnosticSession(sample("shape-mismatch").code, sample("shape-mismatch").traceback).diagnostic.repairable).toBe(false);
    expect(runDiagnosticSession(sample("merge-alignment").code, sample("merge-alignment").traceback).diagnostic.repairable).toBe(false);
  });
});

describe("reparación verificada de punta a punta", () => {
  it.each(["missing-column", "type-mismatch", "invalid-values"])("%s: el patch pasa todos los checkers", (id) => {
    const session = runDiagnosticSession(sample(id).code, sample(id).traceback);
    expect(session.patch).toBeDefined();
    expect(session.checkers.every((checker) => checker.passed)).toBe(false);

    const repaired = applySessionRepair(session);
    expect(repaired.status).toBe("verified");
    expect(repaired.checkers.every((checker) => checker.passed)).toBe(true);
  });

  it("inserta la limpieza de NaN después de definir los datos y antes de fit", () => {
    const session = applySessionRepair(runDiagnosticSession(sample("invalid-values").code, sample("invalid-values").traceback));
    const lines = session.patchedSource!.split("\n");
    const defined = lines.findIndex((line) => line.startsWith("df = pd.DataFrame"));
    const cleaned = lines.findIndex((line) => line.includes("dropna()"));
    const fit = lines.findIndex((line) => line.includes(".fit("));
    expect(defined).toBeLessThan(cleaned);
    expect(cleaned).toBeLessThan(fit);
  });

  it("conserva las comillas simples del código original", () => {
    const source = "df = pd.DataFrame({'revenue_total': [1]})\nx = df['revenue'].sum()";
    const session = applySessionRepair(runDiagnosticSession(source, "KeyError: 'revenue'"));
    expect(session.patchedSource).toContain("df['revenue_total']");
    expect(session.status).toBe("verified");
  });

  it("no inventa un alias cuando no hay candidato inequívoco", () => {
    const source = 'df = pd.DataFrame({"region": ["sur"], "price": [1]})\nx = df["revenue"].sum()';
    const diagnostic = classifyError(source, "KeyError: 'revenue'");
    expect(proposeRepair(source, diagnostic, parsePython(source))).toBeUndefined();
  });

  it("el checker rechaza una reparación que deja otra columna inexistente", () => {
    const source = 'df = pd.DataFrame({"revenue_total": [1]})\na = df["revenue_total"].sum()\nb = df["cost"].sum()';
    const [, columns] = runCheckers(source, { ...UNKNOWN, kind: "missing-column" });
    expect(columns.passed).toBe(false);
    expect(columns.message).toContain("cost");
  });
});

describe("contexto y privacidad", () => {
  it("redacta rutas locales y correos del traceback y del payload", () => {
    const traceback = 'File "C:\\Users\\ana\\proyecto\\x.py", line 2\nKeyError: \'revenue\' (ana@example.com)';
    const source = 'df = pd.DataFrame({"revenue_total": [1]})\nx = df["revenue"].sum()';
    const diagnostic = classifyError(source, traceback);
    const context = selectContext(source, parsePython(source), diagnostic);
    expect(context.payload).not.toMatch(/Users|ana@example\.com/);
    expect(redactSensitive("/home/ana/data.csv")).toBe("<ruta>");
  });

  it("sólo informa símbolos de las líneas seleccionadas", () => {
    const filler = Array.from({ length: 20 }, (_, i) => `far_${i} = ${i}`).join("\n");
    const source = `${filler}\nnear = 1\nx = df["revenue"].sum()`;
    const diagnostic = classifyError(source, "KeyError: 'revenue'");
    const context = selectContext(source, parsePython(source), diagnostic);
    expect(context.symbols).toContain("near");
    expect(context.symbols).not.toContain("far_0");
  });

  it("no duplica líneas cuando una definición multilinea cruza la ventana del error", () => {
    const source = [
      "import pandas as pd",
      "orders = pd.DataFrame({",
      '  "customer_id": [1],',
      '  "total": [20],',
      "})",
      "profiles = pd.DataFrame({\"customer_id\": [1]})",
      "result = process(orders)",
    ].join("\n");
    const diagnostic = classifyError(source, 'File "pipeline.py", line 7\nRuntimeError: proveedor no disponible');
    const context = selectContext(source, parsePython(source), diagnostic);
    expect(new Set(context.lines).size).toBe(context.lines.length);
    expect(context.readOnlyLines).not.toEqual(expect.arrayContaining([5]));
    expect(context.lines.filter((line) => context.readOnlyLines.includes(line))).toEqual(context.readOnlyLines);
  });
});

describe("escalamiento a modelos de Meta", () => {
  it("resuelve en nivel 0 cuando hay patch local", () => {
    const session = runDiagnosticSession(sample("missing-column").code, sample("missing-column").traceback);
    expect(session.escalation).toMatchObject({ level: 0, available: true });
    expect(session.metrics.calls).toBe(0);
  });

  it("propone Glimmer sin patch y Spark con confianza baja, sin conectarse", () => {
    const shape = runDiagnosticSession(sample("shape-mismatch").code, sample("shape-mismatch").traceback);
    expect(shape.escalation).toMatchObject({ level: 2, model: "Muse Glimmer", available: false });
    expect(planEscalation(UNKNOWN, undefined).level).toBe(3);
  });
});

describe("flags y errores ubicables", () => {
  it("mantiene el código intacto cuando no hay patch", () => {
    const source = "print('ok')";
    const result = runCheckers(source, UNKNOWN, new FlagLog());
    expect(result[0].passed).toBe(true);
    expect(source).toBe("print('ok')");
  });

  it("detecta una regresión de sintaxis e ignora delimitadores dentro de strings", () => {
    expect(runCheckers("print((1 + 2)", UNKNOWN)[0].passed).toBe(false);
    expect(runCheckers('print("(")  # )', UNKNOWN)[0].passed).toBe(true);
  });

  it("falla de forma explícita si se aplica un fragmento que ya no existe", () => {
    expect(() => applyPatch("x = 1", {
      id: "test",
      title: "test",
      explanation: "test",
      mode: "replace",
      before: "missing",
      after: "fixed",
      safety: "guarded",
       origin: "rules",
    })).toThrow(/No se encontró/);
  });

  it("entrega los flags al sink externo también cuando la función falla", () => {
    const received: FunctionFlag[] = [];
    expect(() => traced((flag) => received.push(flag), "boom", () => {
      throw new Error("x");
    })).toThrow("x");
    expect(received.map((flag) => flag.phase)).toEqual(["start", "error"]);
  });

  it("conserva ids y timestamps de los flags previos al aplicar el patch", () => {
    const session = runDiagnosticSession(sample("missing-column").code, sample("missing-column").traceback);
    const repaired = applySessionRepair(session);
    expect(repaired.flags.slice(0, session.flags.length)).toEqual(session.flags);
  });
});
