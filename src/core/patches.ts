import { traced, type FlagTarget } from "./flags";
import { splitLines } from "./parser";
import type { Diagnostic, PythonIndex, RepairPatch } from "./types";

const COLUMN_ACCESS_PATTERN = /\[\s*["']([A-Za-z_]\w*)["']\s*\]/g;
const DECLARED_COLUMN_PATTERN = /["']([A-Za-z_]\w*)["']\s*:/g;
const NUMERIC_AGGREGATION_PATTERN = /(\w+)\[\s*["']([A-Za-z_]\w*)["']\s*\]\.(mean|sum|median|std)\s*\(/;
const FIT_PATTERN = /\.fit\s*\(/;

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Columnas declaradas como claves de diccionario (`pd.DataFrame({"col": ...})`). */
export function declaredColumns(source: string): string[] {
  return [...new Set([...source.matchAll(DECLARED_COLUMN_PATTERN)].map((match) => match[1]))];
}

/** Columnas accedidas con `obj["col"]`. */
export function accessedColumns(source: string): string[] {
  return [...source.matchAll(COLUMN_ACCESS_PATTERN)].map((match) => match[1]);
}

/**
 * Devuelve un alias sólo si hay exactamente un candidato que contiene el nombre buscado
 * (o viceversa). Ante empate o ningún parecido no se adivina.
 */
function chooseColumn(source: string, missing: string): string | undefined {
  const target = normalize(missing);
  const candidates = declaredColumns(source).filter((name) => {
    if (name === missing) return false;
    const normalized = normalize(name);
    return normalized.includes(target) || target.includes(normalized);
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

function proposeColumnAlias(source: string, diagnostic: Diagnostic): RepairPatch | undefined {
  const missing = diagnostic.subject ?? accessedColumns(source).find((name) => !declaredColumns(source).includes(name));
  if (!missing) return undefined;
  const column = chooseColumn(source, missing);
  if (!column) return undefined;
  const access = source.match(new RegExp(`\\[\\s*(["'])${missing}\\1\\s*\\]`));
  if (!access) return undefined;
  const quote = access[1];
  return {
    id: "repair-column-alias",
    title: `Usar la columna existente «${column}»`,
    explanation: `Se reemplazan los accesos a «${missing}» porque el índice local encontró «${column}» como único candidato.`,
    mode: "replace",
    before: access[0],
    after: `[${quote}${column}${quote}]`,
    changedLine: diagnostic.line,
    safety: "guarded",
    origin: "rules",
  };
}

function proposeNumericCoercion(source: string, diagnostic: Diagnostic): RepairPatch | undefined {
  const match = source.match(NUMERIC_AGGREGATION_PATTERN);
  if (!match) return undefined;
  const [before, frame, column, aggregation] = match;
  return {
    id: "repair-numeric-coercion",
    title: `Normalizar «${column}» antes de calcular`,
    explanation: "Se aplica conversión numérica tolerante y se conserva la operación original.",
    mode: "replace",
    before,
    after: `pd.to_numeric(${frame}["${column}"], errors="coerce").${aggregation}(`,
    changedLine: diagnostic.line,
    safety: "guarded",
    origin: "rules",
  };
}

function proposeInvalidValueCleanup(source: string): RepairPatch | undefined {
  const lines = splitLines(source);
  const fitIndex = lines.findIndex((line) => FIT_PATTERN.test(line));
  if (fitIndex === -1) return undefined;
  // Se limpia el mismo objeto que llega a fit; si no se reconoce, no se toca el código.
  const frame = lines[fitIndex].match(/\.fit\s*\(\s*([A-Za-z_]\w*)\s*\[/)?.[1];
  if (!frame) return undefined;
  const indent = lines[fitIndex].match(/^\s*/)?.[0] ?? "";
  return {
    id: "repair-invalid-values",
    title: "Limpiar infinitos y filas incompletas",
    explanation: `Se inserta una limpieza explícita de «${frame}» justo antes del entrenamiento para que el checker pueda comprobar la precondición.`,
    mode: "insert",
    before: "",
    after: `${indent}${frame} = ${frame}.replace([np.inf, -np.inf], np.nan).dropna()`,
    changedLine: fitIndex + 1,
    safety: "guarded",
    origin: "rules",
  };
}

export function proposeRepair(
  source: string,
  diagnostic: Diagnostic,
  _index: PythonIndex,
  sink?: FlagTarget,
): RepairPatch | undefined {
  return traced(sink, "proposeRepair", () => {
    if (!diagnostic.repairable) return undefined;
    switch (diagnostic.kind) {
      case "missing-column":
        return proposeColumnAlias(source, diagnostic);
      case "type-mismatch":
        return proposeNumericCoercion(source, diagnostic);
      case "invalid-values":
        return proposeInvalidValueCleanup(source);
      default:
        return undefined;
    }
  });
}

export function applyPatch(source: string, patch: RepairPatch, sink?: FlagTarget): string {
  return traced(sink, "applyPatch", () => {
    if (patch.mode === "insert") {
      const lines = splitLines(source);
      const insertAt = (patch.changedLine ?? 1) - 1;
      if (insertAt < 0 || insertAt > lines.length) {
        throw new Error(`Línea de inserción fuera de rango: ${patch.changedLine}`);
      }
      lines.splice(insertAt, 0, patch.after);
      return lines.join("\n");
    }
    if (!source.includes(patch.before)) {
      throw new Error(`No se encontró el fragmento esperado: ${patch.before}`);
    }
    return source.replaceAll(patch.before, patch.after);
  });
}
