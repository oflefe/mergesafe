import { RiskLevel, Verdict } from "../../../src/domain/types";
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
});
