import { describe, expect, it } from "vitest";
import { runDiagnosticSession } from "./engine";
import { SAMPLE_CASES } from "./samples";

describe("selección de contexto", () => {
  it("en un error sin firma conocida usa la línea que informa el traceback", () => {
    const filler = Array.from({ length: 20 }, (_, i) => `step_${i} = ${i}`).join("\n");
    const source = `import pandas as pd\n${filler}\nresult = pd.Series([1, 2]).rolling(window=0).mean()`;
    const session = runDiagnosticSession(source, 'File "x.py", line 22\nValueError: min_periods 1 must be <= window 0');
    expect(session.diagnostic).toMatchObject({ kind: "unknown", line: 22 });
    expect(session.context.payload).toContain("rolling(window=0)");
    expect(session.context.payload).not.toContain("step_0");
  });

  it("sin línea en el traceback conserva el comportamiento anterior", () => {
    const session = runDiagnosticSession("x = 1\nraise ValueError('boom')", "ValueError: boom");
    expect(session.diagnostic.line).toBe(2);
  });

  it("no repite líneas cuando una definición de varias líneas toca la ventana editable", () => {
    for (const sample of SAMPLE_CASES) {
      const { context } = runDiagnosticSession(sample.code, sample.traceback);
      expect(new Set(context.lines).size, sample.id).toBe(context.lines.length);
      expect(context.readOnlyLines.filter((line) => context.lines.filter((n) => n === line).length > 1), sample.id).toEqual([]);
    }
  });
});
