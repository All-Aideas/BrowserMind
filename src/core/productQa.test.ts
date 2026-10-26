import { describe, expect, it } from "vitest";
import { PRODUCT_QA_EXPECTATIONS, runProductQa } from "./productQa";
import { SAMPLE_CASES } from "./samples";

describe("QA de producto", () => {
  it("aprueba el contrato completo de los cinco casos semilla sin API", () => {
    const report = runProductQa();
    expect(report).toMatchObject({ total: 5, passed: 5, failed: 0 });
    expect(report.results.every((item) => item.passed)).toBe(true);
  });

  it("detecta si un caso deja de cumplir su comportamiento esperado", () => {
    const changed = SAMPLE_CASES.map((sample) => sample.id === "type-mismatch"
      ? { ...sample, traceback: "KeyError: 'revenue'" }
      : sample);
    const report = runProductQa(changed);
    expect(report.failed).toBeGreaterThan(0);
    expect(report.results.find((item) => item.sampleId === "type-mismatch")?.stage).toBe("diagnose");
  });

  it("mantiene una expectativa explícita por caso", () => {
    expect(PRODUCT_QA_EXPECTATIONS).toHaveLength(5);
    expect(PRODUCT_QA_EXPECTATIONS.filter((item) => item.expectsLocalPatch)).toHaveLength(3);
    expect(PRODUCT_QA_EXPECTATIONS.filter((item) => !item.expectsLocalPatch)).toHaveLength(2);
  });
});
