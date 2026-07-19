import {
  PullRequestTypeClassification,
  RiskLevel,
  VerificationDecisionTrace,
  Verdict,
} from "../../domain/types";
import { renderVerificationReport } from "../report-renderer";

const classification: PullRequestTypeClassification = {
  status: "classified",
  advisoryOnly: true,
  classifications: [
    {
      type: "feature",
      score: 0.8123,
      source: "embedding",
      evidence: ["Matched feature prototype."],
    },
  ],
  provider: "ollama",
  model: "all-minilm",
  prototypeVersion: "pr-types-v1",
  inputVersion: "pr-input-v1",
  documentHash: "abc123",
  message: "Semantic classifications are advisory.",
};

const decisionTrace: VerificationDecisionTrace = {
  scope: {
    totalFiles: 1,
    sourceFiles: 1,
    testFiles: 0,
    documentationFiles: 0,
    configurationFiles: 0,
    otherFiles: 0,
    additions: 10,
    deletions: 0,
    totalLineDelta: 10,
    sourceAdditions: 10,
    sourceDeletions: 0,
    sourceLineDelta: 10,
  },
  prClassification: classification,
  risk: {
    score: 0,
    level: RiskLevel.LOW,
    contributions: [],
    evaluatedSignals: [],
  },
  tests: {
    changedSourceFiles: 1,
    coveredSourceFiles: 1,
    uncoveredSourceFiles: 0,
    impactedTests: ["tests/app.spec.ts"],
    missingTestCoverage: [],
    testMappings: [],
  },
  ci: {
    passed: true,
    totalChecks: 1,
    passingChecks: 1,
    pendingChecks: 0,
    failedChecks: 0,
    checks: [],
    reasons: ["All checks pass."],
  },
  policy: { source: "default", rulesEvaluated: 0, failures: [] },
  verdict: { verdict: Verdict.PASS, checkConclusion: "success", reasons: [] },
};

describe("PR classification report", () => {
  it("renders semantic scores as advisory and separates them from risk", () => {
    const report = renderVerificationReport({
      riskScore: 0,
      riskLevel: RiskLevel.LOW,
      verdict: Verdict.PASS,
      riskFindings: [],
      verificationRequirements: [],
      suggestedCommands: [],
      missingTests: [],
      uncategorizedFiles: [],
      externalReviewFindings: [],
      ciSummary: "CI passed.",
      decisionTrace,
    });

    expect(report).toContain("PR Type Classification (advisory)");
    expect(report).toContain("feature (embedding, semantic similarity 0.8123)");
    expect(report).toContain("does not affect risk score");
  });
});
