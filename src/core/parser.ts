import { traced, type FlagTarget } from "./flags";
import type { PythonFunction, PythonIndex, PythonSymbol } from "./types";

const IMPORT_PATTERN = /^\s*(?:import\s+([^#]+)|from\s+(\S+)\s+import\s+([^#]+))/;
const FUNCTION_PATTERN = /^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/;
const ASSIGNMENT_PATTERN = /^\s*([A-Za-z_]\w*)\s*=(?!=)/;

export function splitLines(source: string): string[] {
  return source.split(/\r?\n/);
}

export function parsePython(source: string, sink?: FlagTarget): PythonIndex {
  return traced(sink, "parsePython", () => {
    const lines = splitLines(source);
    const imports: PythonSymbol[] = [];
    const variables: PythonSymbol[] = [];
    const functions: PythonFunction[] = [];

    lines.forEach((rawLine, index) => {
      const line = index + 1;
      const importMatch = rawLine.match(IMPORT_PATTERN);
      if (importMatch) {
        const imported = (importMatch[1] ?? `${importMatch[2]} ${importMatch[3] ?? ""}`).trim();
        imports.push({ name: imported, kind: "import", line });
      }

      const functionMatch = rawLine.match(FUNCTION_PATTERN);
      if (functionMatch) {
        functions.push({
          name: functionMatch[1],
          line,
          arguments: functionMatch[2]
            .split(",")
            .map((argument) => argument.trim())
            .filter(Boolean),
        });
      }

      const variableMatch = rawLine.match(ASSIGNMENT_PATTERN);
      if (variableMatch) {
        variables.push({ name: variableMatch[1], kind: "variable", line });
      }
    });

    return { lines, imports, variables, functions };
  });
}
