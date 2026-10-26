import { traced, type FlagTarget } from "./flags";
import { splitLines } from "./parser";
import type { Diagnostic, ErrorKind, PythonIndex, SelectedContext } from "./types";

interface ClassificationRule {
  kind: Exclude<ErrorKind, "unknown">;
  pattern: RegExp;
  /** Patrón para ubicar la línea en el código cuando el traceback no la indica. */
  locator: RegExp;
  repairable: boolean;
  title: string;
  summary: string;
  nextStep: string;
}

// El orden importa: un KeyError durante un merge es un problema de alineación, no de columna.
const RULES: ClassificationRule[] = [
  {
    kind: "merge-alignment",
    pattern: /\bmerg(?:e|ing)\b|\bjoin\b|alignment|index\s+level/i,
    locator: /\.(?:merge|join)\s*\(/,
    repairable: false,
    title: "Merge o alineación inconsistente",
    summary: "Las claves o índices usados para combinar datos no están alineados.",
    nextStep: "Identificar la clave común y hacer explícita la validación de filas resultantes.",
  },
  {
    kind: "missing-column",
    pattern: /KeyError|column\s+not\s+found|missing\s+column/i,
    locator: /\[\s*["']/,
    repairable: true,
    title: "Nombre de columna inexistente",
    summary: "El código intenta acceder a una columna que no aparece en el DataFrame disponible.",
    nextStep: "Comparar el nombre usado con las columnas indexadas y aplicar un alias sólo si es inequívoco.",
  },
  {
    kind: "type-mismatch",
    pattern: /TypeError|could not convert|unsupported operand/i,
    locator: /\.(?:mean|sum|median|std)\s*\(/,
    repairable: true,
    title: "Tipos incompatibles",
    summary: "Una operación numérica recibe texto u otro tipo que no puede procesar.",
    nextStep: "Normalizar tipos antes de la operación y volver a verificar valores inválidos.",
  },
  {
    kind: "shape-mismatch",
    pattern: /\bshape\b|dimension|n_features|features.*expect|expect.*features/i,
    locator: /\.(?:predict|fit|transform)\s*\(/,
    repairable: false,
    title: "Dimensiones incompatibles",
    summary: "La cantidad o forma de features no coincide con lo que espera el modelo.",
    nextStep: "Comparar shape real contra el contrato del modelo antes de recortar o reordenar datos.",
  },
  {
    kind: "invalid-values",
    pattern: /\bNaN\b|not finite|infinity|invalid value/i,
    locator: /\.fit\s*\(/,
    repairable: true,
    title: "Valores inválidos antes del entrenamiento",
    summary: "Hay NaN, infinitos o valores inválidos en el flujo que llega al modelo.",
    nextStep: "Limpiar infinitos, decidir una estrategia para faltantes y verificar ausencia de NaN.",
  },
];

const PATH_PATTERN = /(?:[A-Za-z]:\\|\/(?:home|Users|tmp|var|mnt)\/)[^\s"',)]+/g;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const TRACEBACK_LINE_PATTERN = /line\s+(\d+)/i;
const QUOTED_SUBJECT_PATTERN = /['"]([A-Za-z_]\w*)['"]/;

/** Quita rutas locales y correos antes de mostrar o enviar texto fuera del núcleo. */
export function redactSensitive(text: string): string {
  return text.replace(PATH_PATTERN, "<ruta>").replace(EMAIL_PATTERN, "<email>");
}

function firstMatchingLine(lines: string[], pattern: RegExp): number | undefined {
  const index = lines.findIndex((line) => pattern.test(line));
  return index === -1 ? undefined : index + 1;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function locateLine(lines: string[], traceback: string, rule: ClassificationRule, subject?: string): number | undefined {
  const reported = Number(traceback.match(TRACEBACK_LINE_PATTERN)?.[1]);
  if (reported >= 1 && reported <= lines.length) return reported;
  if (rule.kind === "missing-column" && subject) {
    const access = new RegExp(`\\[\\s*["']${escapeRegExp(subject)}["']\\s*\\]`);
    const line = firstMatchingLine(lines, access);
    if (line) return line;
  }
  return firstMatchingLine(lines, rule.locator);
}

export function classifyError(source: string, traceback: string, sink?: FlagTarget): Diagnostic {
  return traced(sink, "classifyError", () => {
    const lines = splitLines(source);
    const evidence = redactSensitive(traceback.trim());
    // El traceback manda; el código sólo se usa si el traceback no trae una firma conocida.
    const fromTraceback = RULES.find((rule) => rule.pattern.test(traceback));
    const rule = fromTraceback ?? RULES.find((rule) => rule.pattern.test(source));

    if (!rule) {
      return {
        kind: "unknown",
        title: "Error aún no clasificado",
        summary: "No se encontró una firma segura dentro de las reglas locales del MVP.",
        evidence: evidence || "No se recibió traceback.",
        confidence: 0.2,
        repairable: false,
        nextStep: "Conservar el traceback y escalar sólo el contexto mínimo a un modelo externo.",
        line: firstMatchingLine(lines, /raise\s+/),
      };
    }

    const subject = traceback.match(QUOTED_SUBJECT_PATTERN)?.[1];
    return {
      kind: rule.kind,
      title: rule.title,
      summary: rule.summary,
      evidence: evidence || "Firma encontrada en el código fuente.",
      subject,
      matchedIn: fromTraceback ? "traceback" : "source",
      confidence: fromTraceback ? 0.9 : 0.6,
      repairable: rule.repairable,
      nextStep: rule.nextStep,
      line: locateLine(lines, traceback, rule, subject),
    };
  });
}

export function selectContext(
  source: string,
  index: PythonIndex,
  diagnostic: Diagnostic,
  sink?: FlagTarget,
): SelectedContext {
  return traced(sink, "selectContext", () => {
    const lines = splitLines(source);
    const center = diagnostic.line ?? 1;
    const selected = new Set<number>();
    for (let offset = -2; offset <= 2; offset += 1) {
      const line = center + offset;
      if (line >= 1 && line <= lines.length) selected.add(line);
    }
    index.functions.forEach((fn) => {
      if (Math.abs(fn.line - center) <= 6) selected.add(fn.line);
    });
    const orderedLines = [...selected].sort((a, b) => a - b);
    const code = orderedLines.map((line) => `${line}: ${redactSensitive(lines[line - 1])}`).join("\n");
    const payload = [
      code || "Sin código contextual seleccionado.",
      diagnostic.evidence ? `\n# error\n${diagnostic.evidence}` : "",
    ].join("");

    // Sólo símbolos definidos dentro de las líneas seleccionadas, no todo el archivo.
    const symbols = [...index.variables, ...index.functions]
      .filter((symbol) => selected.has(symbol.line))
      .map((symbol) => symbol.name);

    return {
      lines: orderedLines,
      symbols: [...new Set(symbols)],
      payload,
      redactions: ["rutas locales", "correos electrónicos", "filas del dataset (no se leen)"],
    };
  });
}
