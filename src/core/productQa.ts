import { applySessionRepair, runDiagnosticSession } from "./engine";
import { SAMPLE_CASES, type SampleCase } from "./samples";
import type { ErrorKind, SessionStatus } from "./types";

export type ProductQaStage = "diagnose" | "repair" | "verify" | "manual-review";

export interface ProductQaExpectation {
  sampleId: SampleCase["id"];
  expectedKind: ErrorKind;
  expectsLocalPatch: boolean;
  expectedFinalStatus: Extract<SessionStatus, "verified" | "analyzed">;
}

export interface ProductQaCaseResult {
  sampleId: string;
  label: string;
  passed: boolean;
  stage: ProductQaStage;
  message: string;
  observedKind?: ErrorKind;
  finalStatus?: SessionStatus;
  checkerCount: number;
  passedCheckerCount: number;
}

export interface ProductQaReport {
  generatedAt: string;
  elapsedMs: number;
  total: number;
  passed: number;
  failed: number;
  results: ProductQaCaseResult[];
}

export const PRODUCT_QA_EXPECTATIONS: readonly ProductQaExpectation[] = [
  { sampleId: "missing-column", expectedKind: "missing-column", expectsLocalPatch: true, expectedFinalStatus: "verified" },
  { sampleId: "type-mismatch", expectedKind: "type-mismatch", expectsLocalPatch: true, expectedFinalStatus: "verified" },
  { sampleId: "invalid-values", expectedKind: "invalid-values", expectsLocalPatch: true, expectedFinalStatus: "verified" },
  { sampleId: "shape-mismatch", expectedKind: "shape-mismatch", expectsLocalPatch: false, expectedFinalStatus: "analyzed" },
  { sampleId: "merge-alignment", expectedKind: "merge-alignment", expectsLocalPatch: false, expectedFinalStatus: "analyzed" },
];

function result(
  sample: SampleCase,
  values: Omit<ProductQaCaseResult, "sampleId" | "label">,
): ProductQaCaseResult {
  return { sampleId: sample.id, label: sample.label, ...values };
}

export function runProductQa(samples: readonly SampleCase[] = SAMPLE_CASES): ProductQaReport {
  const startedAt = performance.now();
  const results = PRODUCT_QA_EXPECTATIONS.map((expectation): ProductQaCaseResult => {
    const sample = samples.find((item) => item.id === expectation.sampleId);
    if (!sample) {
      return {
        sampleId: expectation.sampleId,
        label: expectation.sampleId,
        passed: false,
        stage: "diagnose",
        message: "No existe la muestra requerida para este contrato.",
        checkerCount: 0,
        passedCheckerCount: 0,
      };
    }

    try {
      const session = runDiagnosticSession(sample.code, sample.traceback);
      const initialPassed = session.checkers.filter((checker) => checker.passed).length;
      if (session.diagnostic.kind !== expectation.expectedKind) {
        return result(sample, {
          passed: false,
          stage: "diagnose",
          message: `Clasificó ${session.diagnostic.kind}; se esperaba ${expectation.expectedKind}.`,
          observedKind: session.diagnostic.kind,
          finalStatus: session.status,
          checkerCount: session.checkers.length,
          passedCheckerCount: initialPassed,
        });
      }

      if (expectation.expectsLocalPatch) {
        if (!session.patch) {
          return result(sample, {
            passed: false,
            stage: "repair",
            message: "El caso debía tener un patch local verificable y no lo propuso.",
            observedKind: session.diagnostic.kind,
            finalStatus: session.status,
            checkerCount: session.checkers.length,
            passedCheckerCount: initialPassed,
          });
        }
        const repaired = applySessionRepair(session);
        const passed = repaired.status === expectation.expectedFinalStatus && repaired.checkers.every((checker) => checker.passed);
        return result(sample, {
          passed,
          stage: "verify",
          message: passed
            ? "Patch aplicado y todos los checkers aprobaron el resultado."
            : "El patch no alcanzó el estado final esperado o dejó un checker rojo.",
          observedKind: repaired.diagnostic.kind,
          finalStatus: repaired.status,
          checkerCount: repaired.checkers.length,
          passedCheckerCount: repaired.checkers.filter((checker) => checker.passed).length,
        });
      }

      const passed = !session.patch && session.status === expectation.expectedFinalStatus && session.escalation.level === 2;
      return result(sample, {
        passed,
        stage: "manual-review",
        message: passed
          ? "Diagnóstico correcto: queda para revisión manual y escalamiento opcional."
          : "El caso manual no conservó el contrato de revisión/escalamiento esperado.",
        observedKind: session.diagnostic.kind,
        finalStatus: session.status,
        checkerCount: session.checkers.length,
        passedCheckerCount: initialPassed,
      });
    } catch (error) {
      return result(sample, {
        passed: false,
        stage: "diagnose",
        message: error instanceof Error ? error.message : "Falló la corrida del caso.",
        checkerCount: 0,
        passedCheckerCount: 0,
      });
    }
  });

  const passed = results.filter((item) => item.passed).length;
  return {
    generatedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - startedAt),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}
