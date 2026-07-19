import { RiskLevel, Verdict, VerificationDecisionTrace } from "../../../src/domain/types";
import { renderVerificationReport } from "../../../src/verification/report-renderer";

describe("renderVerificationReport", () => {
  it("GIVEN missing and uncategorized files WHEN rendering THEN both diagnostics are visible", () => {
    const report = renderVerificationReport({
      riskScore: 22,
      riskLevel: RiskLevel.MEDIUM,
      verdict: Verdict.NEEDS_REVIEW,
      riskFindings: [],
      verificationRequirements: [],
      suggestedCommands: [],
      missingTests: ["src/billing/invoice.service.ts"],
      uncategorizedFiles: ["src/patients/patient-record.ts"],
      externalReviewFindings: [],
      ciSummary: "CI passed.",
    });

    expect(report).toContain("### Missing test evidence");
    expect(report).toContain("- src/billing/invoice.service.ts");
    expect(report).toContain("### Uncategorized changed files");
    expect(report).toContain("- src/patients/patient-record.ts");
  });

  it("GIVEN long diagnostic lists WHEN rendering THEN omitted entries are counted", () => {
    const report = renderVerificationReport({
      riskScore: 0,
      riskLevel: RiskLevel.LOW,
      verdict: Verdict.PASS,
      riskFindings: [],
      verificationRequirements: [],
      suggestedCommands: [],
      missingTests: Array.from(
        { length: 11 },
        (_, index) => `src/missing-${index}.ts`,
      ),
      uncategorizedFiles: Array.from(
        { length: 11 },
        (_, index) => `src/uncategorized-${index}.ts`,
      ),
      externalReviewFindings: [],
      ciSummary: "CI passed.",
    });

    expect(report).toContain("- 1 additional entries omitted.");
  });

  it("GIVEN a decision trace WHEN rendering THEN scope and decision details are visible", () => {
    const decisionTrace: VerificationDecisionTrace = {
      scope: {
        totalFiles: 2,
        sourceFiles: 1,
        testFiles: 1,
        documentationFiles: 0,
        configurationFiles: 0,
        otherFiles: 0,
        additions: 8,
        deletions: 2,
        totalLineDelta: 10,
        sourceAdditions: 6,
        sourceDeletions: 1,
        sourceLineDelta: 7,
      },
      risk: {
        score: 22,
        level: RiskLevel.MEDIUM,
        contributions: [],
        evaluatedSignals: [
          {
            code: "missing-tests",
            triggered: true,
            weight: 22,
            reason: "No nearby tests were changed.",
          },
        ],
      },
      tests: {
        changedSourceFiles: 1,
        coveredSourceFiles: 0,
        uncoveredSourceFiles: 1,
        impactedTests: [],
        missingTestCoverage: ["src/app.ts"],
        testMappings: [],
      },
      ci: {
        passed: false,
        totalChecks: 1,
        passingChecks: 0,
        pendingChecks: 1,
        failedChecks: 0,
        checks: [],
        reasons: ["1 CI check is still pending."],
      },
      policy: {
        source: "default",
        rulesEvaluated: 0,
        failures: [],
      },
      verdict: {
        verdict: Verdict.NEEDS_REVIEW,
        checkConclusion: "neutral",
        reasons: [
          {
            code: "ci-not-green",
            message: "Existing CI checks are not all passing.",
            source: "ci",
            severity: "review",
          },
        ],
      },
    };
    const report = renderVerificationReport({
      riskScore: 22,
      riskLevel: RiskLevel.MEDIUM,
      verdict: Verdict.NEEDS_REVIEW,
      riskFindings: [],
      verificationRequirements: [],
      suggestedCommands: [],
      missingTests: ["src/app.ts"],
      uncategorizedFiles: [],
      externalReviewFindings: [],
      ciSummary: "CI requires attention.",
      decisionTrace,
    });

    expect(report).toContain("## PR Scope");
    expect(report).toContain("## Risk Decision");
    expect(report).toContain("## Test Evidence");
    expect(report).toContain("## CI Decision");
    expect(report).toContain("## Policy Decision");
    expect(report).toContain("## Verdict Explanation");
    expect(report).toContain("1 CI check is still pending.");
  });
});
