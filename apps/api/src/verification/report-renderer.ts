import {
  ExternalReviewFinding,
  PullRequestTypeClassification,
  RiskFinding,
  RiskLevel,
  VerificationDecisionTrace,
  VerificationRequirement,
  Verdict,
} from "../domain/types";

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function listWithLimit(items: string[], limit = 10): string {
  const visibleItems = items.slice(0, limit);
  const omittedCount = items.length - visibleItems.length;
  return [
    list(visibleItems),
    ...(omittedCount > 0
      ? [`- ${omittedCount} additional entries omitted.`]
      : []),
  ].join("\n");
}

function verdictLabel(verdict: Verdict): string {
  if (verdict === Verdict.PASS) {
    return "Ready for merge with standard review";
  }
  if (verdict === Verdict.NEEDS_REVIEW) {
    return "Needs additional verification before merge";
  }
  return "Do not merge until required evidence is added";
}

function renderPrClassification(
  classification: PullRequestTypeClassification,
): string[] {
  const items = classification.classifications.map((item) => {
    const score =
      item.source === "embedding"
        ? `, semantic similarity ${item.score.toFixed(4)}`
        : "";
    return `${item.type} (${item.source}${score})`;
  });

  return [
    "",
    "## PR Type Classification (advisory)",
    `- Status: ${classification.status}; model: ${classification.model}; prototype set: ${classification.prototypeVersion}.`,
    items.length > 0
      ? listWithLimit(items)
      : "- No PR type classification was emitted.",
    `- ${classification.message}`,
    "- This classification does not affect risk score, policy evaluation, or verdict.",
  ];
}

function renderDecisionTrace(trace: VerificationDecisionTrace): string[] {
  const triggeredSignals = trace.risk.evaluatedSignals
    .filter((signal) => signal.triggered)
    .map((signal) => `${signal.code}: ${signal.reason} (+${signal.weight})`);
  const impactedTests = trace.tests.impactedTests;

  return [
    "",
    "## PR Scope",
    `- ${trace.scope.totalFiles} files: ${trace.scope.sourceFiles} source, ${trace.scope.testFiles} test, ${trace.scope.documentationFiles} documentation, ${trace.scope.configurationFiles} configuration, ${trace.scope.otherFiles} other.`,
    `- ${trace.scope.additions} additions, ${trace.scope.deletions} deletions, ${trace.scope.totalLineDelta} total changed lines.`,
    `- Source-only delta: ${trace.scope.sourceAdditions} additions, ${trace.scope.sourceDeletions} deletions, ${trace.scope.sourceLineDelta} changed lines.`,
    ...(trace.prClassification
      ? renderPrClassification(trace.prClassification)
      : []),
    "",
    "## Risk Decision",
    `- Score: ${trace.risk.score}/100 (${trace.risk.level}).`,
    `- ${triggeredSignals.length} of ${trace.risk.evaluatedSignals.length} evaluated signals triggered.`,
    triggeredSignals.length > 0
      ? listWithLimit(triggeredSignals)
      : "- No risk signals triggered.",
    "",
    "## Test Evidence",
    `- ${trace.tests.changedSourceFiles} changed source files: ${trace.tests.coveredSourceFiles} covered, ${trace.tests.uncoveredSourceFiles} uncovered.`,
    impactedTests.length > 0
      ? `- Impacted tests: ${listWithLimit(impactedTests).replace(/\n/g, " ")}`
      : "- No impacted tests were found.",
    "",
    "## CI Decision",
    `- ${trace.ci.passingChecks}/${trace.ci.totalChecks} checks passing; ${trace.ci.pendingChecks} pending; ${trace.ci.failedChecks} failed or unsupported.`,
    listWithLimit(trace.ci.reasons),
    "",
    "## Policy Decision",
    `- Policy source: ${trace.policy.source}; ${trace.policy.rulesEvaluated} rules evaluated.`,
    trace.policy.failures.length > 0
      ? listWithLimit(
          trace.policy.failures.map((failure) => failure.message),
        )
      : "- No policy failures.",
    "",
    "## Verdict Explanation",
    `- Verdict: ${trace.verdict.verdict}; check conclusion: ${trace.verdict.checkConclusion}.`,
    trace.verdict.reasons.length > 0
      ? listWithLimit(
          trace.verdict.reasons.map((reason) => reason.message),
        )
      : "- No blocking reasons recorded.",
  ];
}

export function renderVerificationReport(input: {
  riskScore: number;
  riskLevel: RiskLevel;
  verdict: Verdict;
  riskFindings: RiskFinding[];
  verificationRequirements: VerificationRequirement[];
  suggestedCommands: string[];
  missingTests: string[];
  uncategorizedFiles: string[];
  externalReviewFindings: ExternalReviewFinding[];
  ciSummary: string;
  decisionTrace?: VerificationDecisionTrace;
}): string {
  const report = [
    "<!-- mergesafe-verification -->",
    "## MergeSafe Verification",
    `**Risk score:** ${input.riskScore}/100 (${input.riskLevel})`,
    `**Verdict:** ${verdictLabel(input.verdict)}`,
    "",
    "### Why this PR is risky",
    input.riskFindings.length > 0
      ? list(
          input.riskFindings.map(
            (finding) => `${finding.reason} (+${finding.weight})`,
          ),
        )
      : "- No high-risk signals detected.",
    "",
    "### Required verification steps",
    input.verificationRequirements.length > 0
      ? list(
          input.verificationRequirements.map(
            (requirement) => requirement.message,
          ),
        )
      : "- No policy failures detected.",
    "",
    "### Suggested test commands",
    input.suggestedCommands.length > 0
      ? list(input.suggestedCommands)
      : "- No test command could be inferred.",
    "",
    "### Missing test evidence",
    input.missingTests.length > 0
      ? listWithLimit(input.missingTests)
      : "- No obvious missing tests detected.",
    "",
    "### Uncategorized changed files (informational)",
    input.uncategorizedFiles.length > 0
      ? listWithLimit(input.uncategorizedFiles)
      : "- No uncategorized changed files detected.",
    "",
    "### Existing AI-review findings",
    input.externalReviewFindings.length > 0
      ? list(
          input.externalReviewFindings.map(
            (finding) =>
              `[${finding.source}] ${finding.body.replace(/\s+/g, " ")}`,
          ),
        )
      : "- No unresolved AI-review findings were detected.",
    "",
    "### CI status",
    `- ${input.ciSummary}`,
  ];

  if (input.decisionTrace) {
    report.push(...renderDecisionTrace(input.decisionTrace));
  }

  return report.join("\n");
}
