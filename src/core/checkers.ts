import { traced, type FlagTarget } from "./flags";
import { splitLines } from "./parser";
import { accessedColumns, declaredColumns } from "./patches";
import type { CheckerResult, Diagnostic } from "./types";

// Los checkers inspeccionan el código resultante por su cuenta: no leen el patch
// propuesto, así una reparación no puede aprobarse a sí misma.

function stripStringsAndComments(source: string): string {
  return source
    .replace(/("""|''')[\s\S]*?\1/g, "")
    .replace(/(["'])(?:\\.|(?!\1).)*\1/g, "")
    .replace(/#.*$/gm, "");
}

function checkBalancedDelimiters(source: string): CheckerResult {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const closers = new Set(Object.values(pairs));
  const stack: string[] = [];
  for (const char of stripStringsAndComments(source)) {
    if (pairs[char]) stack.push(char);
    else if (closers.has(char)) {
      const open = stack.pop();
      if (!open || pairs[open] !== char) {
        return { id: "syntax-delimiters", name: "Delimitadores balanceados", passed: false, message: `Cierre inesperado «${char}».` };
      }
    }
  }
  return {
    id: "syntax-delimiters",
    name: "Delimitadores balanceados",
    passed: stack.length === 0,
    message: stack.length === 0 ? "Paréntesis, corchetes y llaves balanceados." : "Quedaron delimitadores abiertos.",
  };
}

function checkColumnsExist(source: string): CheckerResult {
  const declared = declaredColumns(source);
  const unresolved = accessedColumns(source).filter((column) => !declared.includes(column));
  const passed = declared.length > 0 && unresolved.length === 0;
  return {
    id: "missing-column-resolved",
    name: "Columna solicitada existe",
    passed,
    message: declared.length === 0
      ? "No se encontraron columnas declaradas para comparar."
      : passed
        ? "Todos los accesos usan columnas declaradas."
        : `Accesos a columnas no declaradas: ${[...new Set(unresolved)].join(", ")}.`,
    expected: declared.join(", ") || "columnas declaradas",
    actual: [...new Set(accessedColumns(source))].join(", ") || "sin accesos",
  };
}

function checkNumericInput(source: string): CheckerResult {
  const rawAggregation = /\w+\[\s*["'][A-Za-z_]\w*["']\s*\]\.(?:mean|sum|median|std)\s*\(/.test(source);
  const normalized = /to_numeric\s*\(/.test(source);
  const passed = normalized && !rawAggregation;
  return {
    id: "numeric-input",
    name: "Entrada numérica normalizada",
    passed,
    message: passed
      ? "Las agregaciones reciben columnas normalizadas."
      : "Queda una agregación sobre una columna sin normalizar.",
  };
}

function checkFiniteBeforeFit(source: string): CheckerResult {
  const lines = splitLines(source);
  const fitLine = lines.findIndex((line) => /\.fit\s*\(/.test(line));
  const cleanLine = lines.findIndex((line) => /replace\(\s*\[\s*np\.inf\s*,\s*-np\.inf\s*\]\s*,\s*np\.nan\s*\)\.dropna\(\)/.test(line));
  const frame = lines[cleanLine]?.match(/^\s*([A-Za-z_]\w*)\s*=/)?.[1];
  const definedAt = frame ? lines.findIndex((line) => new RegExp(`^\\s*${frame}\\s*=(?!=)`).test(line)) : -1;
  const passed = cleanLine !== -1 && fitLine !== -1 && definedAt < cleanLine && cleanLine < fitLine;
  return {
    id: "finite-values",
    name: "Sin NaN ni infinitos antes del modelo",
    passed,
    message: passed
      ? "La limpieza ocurre después de definir los datos y antes de entrenar."
      : cleanLine === -1
        ? "Falta limpiar valores inválidos."
        : "La limpieza no está entre la definición de los datos y el entrenamiento.",
    line: cleanLine === -1 ? undefined : cleanLine + 1,
  };
}

/** Columnas declaradas en la definición de `frame` (`frame = pd.DataFrame({...})`, aunque ocupe varias líneas). */
function frameColumns(source: string, frame: string): string[] {
  const lines = splitLines(source);
  const start = lines.findIndex((line) => new RegExp(`^\\s*${frame}\\s*=\\s*pd\\.DataFrame\\(`).test(line));
  if (start === -1) return [];
  let end = start + 1;
  while (end < lines.length && /^\s/.test(lines[end])) end += 1;
  if (end < lines.length && /^[)\]}]/.test(lines[end])) end += 1;
  return declaredColumns(lines.slice(start, end).join("\n"));
}

function checkMergeKeys(source: string): CheckerResult {
  const call = source.match(/(\w+)\.merge\(\s*(\w+)\s*,([^)]*)\)/);
  const base = { id: "merge-keys", name: "Claves de merge presentes en ambos lados" };
  if (!call) return { ...base, passed: false, message: "No se encontró una llamada a merge para verificar." };
  const [, left, right, args] = call;
  const on = args.match(/\bon\s*=\s*["'](\w+)["']/)?.[1];
  const leftKey = on ?? args.match(/\bleft_on\s*=\s*["'](\w+)["']/)?.[1];
  const rightKey = on ?? args.match(/\bright_on\s*=\s*["'](\w+)["']/)?.[1];
  const leftColumns = frameColumns(source, left);
  const rightColumns = frameColumns(source, right);
  if (!leftKey || !rightKey || leftColumns.length === 0 || rightColumns.length === 0) {
    return { ...base, passed: false, message: "No se pudieron determinar las claves o columnas de ambos DataFrames." };
  }
  const passed = leftColumns.includes(leftKey) && rightColumns.includes(rightKey);
  return {
    ...base,
    passed,
    message: passed
      ? `«${left}.${leftKey}» y «${right}.${rightKey}» existen.`
      : `Clave ausente: ${leftColumns.includes(leftKey) ? `«${rightKey}» en ${right}` : `«${leftKey}» en ${left}`}.`,
    expected: `${left}: ${leftColumns.join(", ")} · ${right}: ${rightColumns.join(", ")}`,
    actual: `${leftKey} ↔ ${rightKey}`,
  };
}

function checkFeatureCount(source: string, diagnostic: Diagnostic): CheckerResult {
  const base = { id: "feature-count", name: "Cantidad de features compatible" };
  const expected = Number(diagnostic.evidence.match(/expect\w*\s+(\d+)/i)?.[1]);
  const actual = Number(source.match(/np\.(?:ones|zeros|empty)\(\s*\(\s*\d+\s*,\s*(\d+)\s*\)/)?.[1]);
  if (!expected || !actual) {
    // Sin ejecución real (Pyodide) no hay forma estática de comprobarlo: no se aprueba.
    return { ...base, passed: false, message: "No se puede verificar la shape sin ejecutar el código." };
  }
  return {
    ...base,
    passed: actual === expected,
    message: actual === expected ? `La matriz tiene ${actual} features, como espera el modelo.` : `La matriz tiene ${actual} features y el modelo espera ${expected}.`,
    expected: String(expected),
    actual: String(actual),
  };
}

/** Las líneas modificadas entre `original` y `patched` deben estar dentro de `allowedLines`. */
export function checkChangesWithinContext(original: string, patched: string, allowedLines: readonly number[]): CheckerResult {
  const before = splitLines(original);
  const after = splitLines(patched);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (endBefore >= start && endAfter >= start && before[endBefore] === after[endAfter]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const changed = Array.from({ length: Math.max(0, endBefore - start + 1) }, (_, offset) => start + offset + 1);
  const outside = changed.filter((line) => !allowedLines.includes(line));
  return {
    id: "within-context",
    name: "Cambios dentro del contexto enviado",
    passed: outside.length === 0,
    message: outside.length === 0
      ? "El modelo sólo modificó líneas que recibió."
      : `El patch toca líneas que el modelo no vio: ${outside.join(", ")}.`,
  };
}

export function runCheckers(source: string, diagnostic: Diagnostic, sink?: FlagTarget): CheckerResult[] {
  return traced(sink, "runCheckers", () => {
    const checks: CheckerResult[] = [checkBalancedDelimiters(source)];
    if (diagnostic.kind === "missing-column") checks.push(checkColumnsExist(source));
    if (diagnostic.kind === "type-mismatch") checks.push(checkNumericInput(source));
    if (diagnostic.kind === "invalid-values") checks.push(checkFiniteBeforeFit(source));
    if (diagnostic.kind === "merge-alignment") checks.push(checkMergeKeys(source));
    if (diagnostic.kind === "shape-mismatch") checks.push(checkFeatureCount(source, diagnostic));
    return checks;
  });
}
