import { describe, expect, it } from "vitest";
import { loadSourceFile, notebookToPython } from "./sourceLoader";

describe("sourceLoader", () => {
  it("carga un script Python sin modificarlo", () => {
    const code = "print('ok')\n";
    expect(loadSourceFile("demo.py", code)).toEqual({
      name: "demo.py",
      kind: "python-script",
      code,
    });
  });

  it("convierte celdas de código y conserva markdown como comentario", () => {
    const notebook = JSON.stringify({
      cells: [
        { cell_type: "markdown", source: ["# Título\n", "Descripción"] },
        { cell_type: "code", source: ["value = 2\n", "print(value)\n"] },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    });

    const code = notebookToPython(notebook);
    expect(code).toContain("# %% [markdown] 1");
    expect(code).toContain("# # Título");
    expect(code).toContain("# %% [code] 2");
    expect(code).toContain("value = 2\nprint(value)");
  });

  it("rechaza notebooks inválidos y extensiones desconocidas", () => {
    expect(() => notebookToPython("no-json")).toThrow("JSON válido");
    expect(() => notebookToPython("{}")) .toThrow("lista de celdas");
    expect(() => loadSourceFile("data.csv", "x,y")).toThrow("Formato no compatible");
    expect(() => loadSourceFile("empty.py", "  ")).toThrow("vacío");
  });
});
