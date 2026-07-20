import {
  CiDecisionTrace,
  PolicyFailure,
  RiskLevel,
  Verdict,
} from "../../../src/domain/types";
import { evaluateVerdict } from "../../../src/verification/verdict-decision";

const greenCi: CiDecisionTrace = {
  passed: true,
  totalChecks: 1,
  passingChecks: 1,
  pendingChecks: 0,
  failedChecks: 0,
  checks: [],
  reasons: [],
};

const failingCi: CiDecisionTrace = {
  ...greenCi,
  passed: false,
  passingChecks: 0,
  failedChecks: 1,
};

describe("evaluateVerdict", () => {
  it("GIVEN low risk and green CI WHEN evaluating verdict THEN it passes", () => {
    expect(
      evaluateVerdict({
        riskLevel: RiskLevel.LOW,
        policyFailures: [],
        ci: greenCi,
      }),
    ).toMatchObject({ verdict: Verdict.PASS, checkConclusion: "success", reasons: [] });
  });

  it("GIVEN low risk and bad CI WHEN evaluating verdict THEN it needs review", () => {
    expect(
      evaluateVerdict({
        riskLevel: RiskLevel.LOW,
        policyFailures: [],
        ci: failingCi,
      }),
    ).toMatchObject({ verdict: Verdict.NEEDS_REVIEW, checkConclusion: "neutral" });
  });

  it.each([
    [RiskLevel.MEDIUM, Verdict.NEEDS_REVIEW, "medium-risk"],
    [RiskLevel.HIGH, Verdict.NEEDS_REVIEW, "high-risk"],
    [RiskLevel.CRITICAL, Verdict.FAIL, "critical-risk"],
  ])(
    "GIVEN %s risk WHEN evaluating verdict THEN it preserves the existing priority",
    (riskLevel, verdict, reasonCode) => {
      const result = evaluateVerdict({
        riskLevel,
        policyFailures: [],
        ci: greenCi,
      });

      expect(result.verdict).toBe(verdict);
      expect(result.reasons.map((reason) => reason.code)).toContain(reasonCode);
    },
  );

  it("GIVEN a policy review requirement WHEN evaluating verdict THEN it needs review", () => {
    const policyFailures: PolicyFailure[] = [
      { code: "tests", verdict: Verdict.NEEDS_REVIEW, message: "Add tests." },
    ];

    expect(
      evaluateVerdict({ riskLevel: RiskLevel.LOW, policyFailures, ci: greenCi }),
    ).toMatchObject({ verdict: Verdict.NEEDS_REVIEW });
  });

  it("GIVEN a policy failure WHEN evaluating verdict THEN it fails", () => {
    const policyFailures: PolicyFailure[] = [
      { code: "security", verdict: Verdict.FAIL, message: "Security review required." },
    ];

    expect(
      evaluateVerdict({ riskLevel: RiskLevel.LOW, policyFailures, ci: greenCi }),
    ).toMatchObject({ verdict: Verdict.FAIL, checkConclusion: "failure" });
  });

  it("GIVEN multiple simultaneous reasons WHEN evaluating verdict THEN it reports each reason", () => {
    const result = evaluateVerdict({
      riskLevel: RiskLevel.HIGH,
      policyFailures: [
        { code: "security", verdict: Verdict.NEEDS_REVIEW, message: "Review security." },
      ],
      ci: failingCi,
    });

    expect(result.reasons.map((reason) => reason.code)).toEqual([
      "policy-review",
      "high-risk",
      "ci-not-green",
    ]);
  });
});
