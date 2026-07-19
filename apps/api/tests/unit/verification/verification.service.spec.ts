import { VerificationService } from "./verification.service";
import { PolicyLoader } from "./policy-loader";
import { Verdict } from "../domain/types";
import { safeDocsPr } from "../../test/fixtures/pull-request.fixtures";

describe("VerificationService", () => {
  it("uses the default policy when the repository has no policy file", () => {
    const service = new VerificationService(new PolicyLoader());

    const result = service.verify({
      ...safeDocsPr,
      policyText: undefined,
    });

    expect(result.policyFailures.map((failure) => failure.code)).not.toContain(
      "policy-config-invalid",
    );
    expect(result.decisionTrace?.policy).toMatchObject({
      source: "default",
      rulesEvaluated: 0,
      failures: [],
    });
  });

  it("fails safely when the policy config is invalid", () => {
    const service = new VerificationService(new PolicyLoader());

    const result = service.verify({
      ...safeDocsPr,
      policyText: "version: 2\nrules: []\n",
    });

    expect(result.verdict).toBe(Verdict.FAIL);
    expect(result.checkConclusion).toBe("failure");
    expect(result.policyFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "policy-config-invalid",
          verdict: Verdict.FAIL,
          message: "Invalid policy config: version must be 1.",
        }),
      ]),
    );
    expect(result.commentBody).toContain(
      "Invalid policy config: version must be 1.",
    );
    expect(result.decisionTrace?.policy.source).toBe("repository");
    expect(result.decisionTrace?.verdict.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "policy-failure", source: "policy" }),
      ]),
    );
  });

  it("GIVEN one covered and one uncovered source WHEN verifying THEN missing coverage is per file", () => {
    const service = new VerificationService(new PolicyLoader());
    const result = service.verify({
      ...safeDocsPr,
      changedFiles: [
        { path: "src/patient.service.ts", additions: 4, deletions: 1 },
        { path: "src/billing.service.ts", additions: 4, deletions: 1 },
      ],
      repositoryFiles: {
        "src/patient.service.ts": "export const patient = true;",
        "src/billing.service.ts": "export const billing = true;",
        "tests/patient.service.spec.ts": "describe('patient', () => {});",
      },
    });

    expect(result.testImpact.missingTestCoverage).toEqual([
      "src/billing.service.ts",
    ]);
    expect(result.riskFindings.map((finding) => finding.code)).toContain(
      "missing-tests",
    );
    expect(result.decisionTrace?.tests).toMatchObject({
      changedSourceFiles: 2,
      coveredSourceFiles: 1,
      uncoveredSourceFiles: 1,
      missingTestCoverage: ["src/billing.service.ts"],
    });
  });

  it("GIVEN only an uncategorized source with mapped tests WHEN verifying THEN the verdict stays passing", () => {
    const service = new VerificationService(new PolicyLoader());
    const result = service.verify({
      ...safeDocsPr,
      changedFiles: [{ path: "src/profile.ts", additions: 4, deletions: 1 }],
      repositoryFiles: {
        "src/profile.ts": "export const profile = true;",
        "tests/profile.spec.ts": "describe('profile', () => {});",
      },
    });

    expect(result.riskDiagnostics.uncategorizedFiles).toEqual([
      "src/profile.ts",
    ]);
    expect(result.verdict).toBe(Verdict.PASS);
  });

  it("GIVEN repository policy text WHEN verifying THEN the trace reports repository policy source", () => {
    const service = new VerificationService(new PolicyLoader());
    const result = service.verify({
      ...safeDocsPr,
      policyText: "version: 1\nrules: []\n",
    });

    expect(result.decisionTrace?.policy.source).toBe("repository");
  });

  it("GIVEN a verification result WHEN reading the decision trace THEN it remains consistent with legacy fields", () => {
    const service = new VerificationService(new PolicyLoader());
    const result = service.verify(safeDocsPr);
    const trace = result.decisionTrace;

    expect(trace?.risk.score).toBe(result.riskScore);
    expect(trace?.risk.level).toBe(result.riskLevel);
    expect(trace?.risk.contributions).toEqual(result.riskFindings);
    expect(trace?.ci.passed).toBe(result.ciPassed);
    expect(trace?.tests.impactedTests).toEqual(result.testImpact.impactedTests);
    expect(trace?.tests.missingTestCoverage).toEqual(
      result.testImpact.missingTestCoverage,
    );
    expect(trace?.verdict.verdict).toBe(result.verdict);
    expect(trace?.verdict.checkConclusion).toBe(result.checkConclusion);
  });
});
