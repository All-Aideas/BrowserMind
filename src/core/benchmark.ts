import { applySessionRepair, runDiagnosticSession } from "./engine";
import { SAMPLE_CASES, type SampleCase } from "./samples";

export type BenchmarkConfig = "A" | "B" | "C" | "D";
export type BenchmarkTaskStatus = "resolved" | "manual-review" | "not-configured" | "failed";

export interface BenchmarkConfigSummary {
  config: BenchmarkConfig;
  label: string;
  total: number;
  attempted: number;
  resolved: number;
  notConfigured: number;
  totalTokens: number;
}

export interface BenchmarkTaskResult {
  id: string;
  config: BenchmarkConfig;
  configLabel: string;
  sampleId: string;
  sampleLabel: string;
  status: BenchmarkTaskStatus;
  diagnosticKind?: string;
  totalTokens: number;
  elapsedMs: number;
  message: string;
}

export interface BenchmarkReport {
  generatedAt: string;
  total: number;
  resolved: number;
  attempted: number;
  notConfigured: number;
  tasks: BenchmarkTaskResult[];
  summaries: BenchmarkConfigSummary[];
}

const CONFIGURATIONS: readonly { config: BenchmarkConfig; label: string; available: boolean }[] = [
  { config: "A", label: "Reglas locales", available: true },
  { config: "B", label: "Reglas + contexto", available: true },
  { config: "C", label: "Glimmer", available: false },
  { config: "D", label: "Spark", available: false },
];

function runLocalTask(sample: SampleCase, config: BenchmarkConfig): BenchmarkTaskResult {
  const startedAt = performance.now();
  try {
    const session = runDiagnosticSession(sample.code, sample.traceback);
    const tokens = config === "B" ? session.metrics.estimatedTokens : 0;
    if (!session.patch) {
      return {
        id: `${config}-${sample.id}`,
        config,
        configLabel: config === "A" ? "Reglas locales" : "Reglas + contexto",
        sampleId: sample.id,
        sampleLabel: sample.label,
        status: "manual-review",
        diagnosticKind: session.diagnostic.kind,
        totalTokens: tokens,
        elapsedMs: Math.round(performance.now() - startedAt),
        message: "Diagnóstico correcto, pero no hay patch seguro para aplicar.",
      };
    }
    const repaired = applySessionRepair(session);
    const resolved = repaired.status === "verified" && repaired.checkers.every((checker) => checker.passed);
    return {
      id: `${config}-${sample.id}`,
      config,
      configLabel: config === "A" ? "Reglas locales" : "Reglas + contexto",
      sampleId: sample.id,
      sampleLabel: sample.label,
      status: resolved ? "resolved" : "failed",
      diagnosticKind: repaired.diagnostic.kind,
      totalTokens: tokens,
      elapsedMs: Math.round(performance.now() - startedAt),
      message: resolved ? "Patch aplicado y todos los checkers aprobaron." : "El patch dejó al menos un checker rojo.",
    };
  } catch (error) {
    return {
      id: `${config}-${sample.id}`,
      config,
      configLabel: config === "A" ? "Reglas locales" : "Reglas + contexto",
      sampleId: sample.id,
      sampleLabel: sample.label,
      status: "failed",
      totalTokens: 0,
      elapsedMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : "Falló la tarea.",
    };
  }
}

export function runProductBenchmark(samples: readonly SampleCase[] = SAMPLE_CASES): BenchmarkReport {
  const tasks = CONFIGURATIONS.flatMap(({ config, label, available }) => samples.map((sample) => {
    if (!available) {
      return {
        id: `${config}-${sample.id}`,
        config,
        configLabel: label,
        sampleId: sample.id,
        sampleLabel: sample.label,
        status: "not-configured" as const,
        totalTokens: 0,
        elapsedMs: 0,
        message: `${label} todavía no está conectado; la tarea no se cuenta como resuelta.`,
      };
    }
    return runLocalTask(sample, config);
  }));

  const summaries = CONFIGURATIONS.map(({ config, label }) => {
    const configTasks = tasks.filter((task) => task.config === config);
    return {
      config,
      label,
      total: configTasks.length,
      attempted: configTasks.filter((task) => task.status !== "not-configured").length,
      resolved: configTasks.filter((task) => task.status === "resolved").length,
      notConfigured: configTasks.filter((task) => task.status === "not-configured").length,
      totalTokens: configTasks.reduce((sum, task) => sum + task.totalTokens, 0),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    total: tasks.length,
    resolved: tasks.filter((task) => task.status === "resolved").length,
    attempted: tasks.filter((task) => task.status !== "not-configured").length,
    notConfigured: tasks.filter((task) => task.status === "not-configured").length,
    tasks,
    summaries,
  };
}
