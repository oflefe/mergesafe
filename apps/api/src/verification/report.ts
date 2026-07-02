import {
  ExternalReviewFinding,
  ReviewComment,
  RiskFinding,
  VerificationRequirement,
  VerificationResult,
} from "../domain/types";

function list(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function summarizeExternalFindings(
  reviewComments: ReviewComment[],
): ExternalReviewFinding[] {
  return reviewComments
    .filter((comment) =>
      /(coderabbit|copilot|claude|cursor|codex)/i.test(comment.author),
    )
    .filter((comment) => !comment.resolved)
    .map((comment) => ({
      source: comment.author,
      author: comment.author,
      body: comment.body.trim(),
    }));
}

export function summarizeCi(
  checkRuns: VerificationResult["testImpact"]["suggestedCommands"],
  ciPassed: boolean,
  rawCheckRuns: { name: string; conclusion: string | null }[],
): string {
  if (rawCheckRuns.length === 0) {
    return "No CI checks were reported on the pull request.";
  }
  const summary = rawCheckRuns
    .map((checkRun) => `${checkRun.name}: ${checkRun.conclusion ?? "pending"}`)
    .join(", ");
  return `${ciPassed ? "CI passed" : "CI requires attention"} — ${summary}`;
}

export function buildVerificationComment(input: {
  riskScore: number;
  verdict: VerificationResult["verdict"];
  riskFindings: RiskFinding[];
  verificationRequirements: VerificationRequirement[];
  suggestedCommands: string[];
  missingTests: string[];
  externalReviewFindings: ExternalReviewFinding[];
  ciSummary: string;
}): string {
  const verdictLabel =
    input.verdict === "pass"
      ? "Ready for merge with standard review"
      : input.verdict === "neutral"
        ? "Needs additional verification before merge"
        : "Do not merge until required evidence is added";

  return [
    "<!-- mergesafe-verification -->",
    "## MergeSafe Verification",
    `**Risk score:** ${input.riskScore}/100`,
    `**Verdict:** ${verdictLabel}`,
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
      : "- No hard policy failures detected.",
    "",
    "### Suggested test commands",
    input.suggestedCommands.length > 0
      ? list(input.suggestedCommands)
      : "- No test command could be inferred.",
    "",
    "### Missing tests",
    input.missingTests.length > 0
      ? list(input.missingTests)
      : "- No obvious missing tests detected.",
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
