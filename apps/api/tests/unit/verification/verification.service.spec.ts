import { VerificationService } from "../../../src/verification/verification.service";
import { PolicyLoader } from "../../../src/verification/policy-loader";
import { Verdict } from "../../../src/domain/types";
import { safeDocsPr } from "../../fixtures/pull-request.fixtures";

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
});
