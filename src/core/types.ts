export type ErrorKind =
  | "missing-column"
  | "type-mismatch"
  | "shape-mismatch"
  | "invalid-values"
  | "merge-alignment"
  | "unknown";

export type TracePhase = "start" | "success" | "error";
export type TraceLevel = "info" | "success" | "error";
export type SessionStatus = "idle" | "analyzed" | "patched" | "verified" | "failed";

export interface FunctionFlag {
  id: string;
  functionName: string;
  phase: TracePhase;
  level: TraceLevel;
  timestamp: string;
  durationMs?: number;
  line?: number;
  message: string;
  details?: string;
}

export type FlagSink = (flag: FunctionFlag) => void;

export interface PythonFunction {
  name: string;
  line: number;
  arguments: string[];
}

export interface PythonSymbol {
  name: string;
  kind: "variable" | "function" | "import";
  line: number;
}

export interface PythonIndex {
  lines: string[];
  imports: PythonSymbol[];
  variables: PythonSymbol[];
  functions: PythonFunction[];
}

export interface Diagnostic {
  kind: ErrorKind;
  title: string;
  summary: string;
  evidence: string;
  line?: number;
  /** Símbolo citado por el traceback (por ejemplo, la columna de un KeyError). */
  subject?: string;
  /** Dónde se encontró la firma del error: el traceback es más confiable que el código. */
  matchedIn?: "traceback" | "source";
  confidence: number;
  repairable: boolean;
  nextStep: string;
}

export interface SelectedContext {
  /** Todas las líneas que viajan al modelo. */
  lines: number[];
  /** Definiciones agregadas como referencia: el modelo las ve pero no puede modificarlas. */
  readOnlyLines: number[];
  symbols: string[];
  payload: string;
  redactions: string[];
}

export interface RepairPatch {
  id: string;
  title: string;
  explanation: string;
  /** `replace` sustituye `before` por `after`; `insert` agrega `after` antes de `changedLine`. */
  mode: "replace" | "insert";
  before: string;
  after: string;
  changedLine?: number;
  safety: "safe" | "guarded" | "manual";
  /** `rules` = plantilla local (nivel 0); `model` = generado por un modelo de Meta. */
  origin: "rules" | "model";
}

export interface CheckerResult {
  id: string;
  name: string;
  passed: boolean;
  message: string;
  line?: number;
  expected?: string;
  actual?: string;
}

export type EscalationLevel = 0 | 1 | 2 | 3;

export interface EscalationPlan {
  level: EscalationLevel;
  model: string;
  reason: string;
  /** Falso mientras no exista un adaptador de modelo configurado. */
  available: boolean;
  /** Verdadero una vez que se llamó al modelo de ese nivel. */
  used?: boolean;
}

export interface SessionMetrics {
  calls: number;
  estimatedTokens: number;
  /** Tokens informados por el endpoint (prompt + completion) en las llamadas generativas. */
  generativeTokens: number;
  modelLatencyMs: number;
  selectedLines: number;
  elapsedMs: number;
}

export interface DiagnosticSession {
  id: string;
  status: SessionStatus;
  source: string;
  patchedSource?: string;
  traceback: string;
  index: PythonIndex;
  diagnostic: Diagnostic;
  context: SelectedContext;
  patch?: RepairPatch;
  checkers: CheckerResult[];
  escalation: EscalationPlan;
  /** Motivo del modelo cuando no propuso un patch, o por qué se descartó. */
  modelNote?: string;
  flags: FunctionFlag[];
  metrics: SessionMetrics;
}
