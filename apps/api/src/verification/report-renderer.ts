import {
  ExternalReviewFinding,
  RiskFinding,
  RiskLevel,
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
}): string {
  return [
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
  ].join("\n");
}
