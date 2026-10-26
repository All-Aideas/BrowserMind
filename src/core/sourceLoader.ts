export type SourceKind = "python-script" | "notebook";

export interface LoadedSource {
  name: string;
  kind: SourceKind;
  code: string;
}

interface NotebookCell {
  cell_type?: unknown;
  source?: unknown;
}

interface NotebookDocument {
  cells?: unknown;
}

function sourceText(source: unknown): string {
  if (typeof source === "string") return source;
  if (Array.isArray(source) && source.every((line) => typeof line === "string")) {
    return source.join("");
  }
  return "";
}

function commentMarkdown(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => `# ${line}`.trimEnd())
    .join("\n");
}

export function notebookToPython(raw: string): string {
  let document: NotebookDocument;
  try {
    document = JSON.parse(raw) as NotebookDocument;
  } catch {
    throw new Error("El archivo .ipynb no contiene JSON válido.");
  }

  if (!Array.isArray(document.cells)) {
    throw new Error("El notebook no contiene una lista de celdas válida.");
  }

  const cells = document.cells as NotebookCell[];
  const code = cells.flatMap((cell, index) => {
    const source = sourceText(cell.source);
    const type = cell.cell_type;
    if (!source && type !== "code" && type !== "markdown") return [];
    if (type === "code") return [`# %% [code] ${index + 1}`, source];
    if (type === "markdown") return [`# %% [markdown] ${index + 1}`, commentMarkdown(source)];
    return [`# %% [raw] ${index + 1}`, commentMarkdown(source)];
  });

  const result = code.join("\n").trim();
  if (!result) throw new Error("El notebook no contiene código ni texto para cargar.");
  return `${result}\n`;
}

export function loadSourceFile(name: string, content: string): LoadedSource {
  const normalizedName = name.trim() || "fuente.py";
  if (!content.trim()) throw new Error("El archivo está vacío.");

  if (normalizedName.toLowerCase().endsWith(".ipynb")) {
    return { name: normalizedName, kind: "notebook", code: notebookToPython(content) };
  }

  if (!/\.(py|txt)$/i.test(normalizedName)) {
    throw new Error("Formato no compatible. Cargá un archivo .py o .ipynb.");
  }

  return { name: normalizedName, kind: "python-script", code: content };
}
