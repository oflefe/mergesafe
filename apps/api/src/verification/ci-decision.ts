import {
  CheckRunSnapshot,
  CiDecisionTrace,
} from "../domain/types";

const acceptedConclusions = new Set(["success", "neutral", "skipped"]);

export function evaluateCiChecks(checkRuns: CheckRunSnapshot[]): {
  passed: boolean;
  decisionTrace: CiDecisionTrace;
} {
  const checks = [...checkRuns]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((checkRun) => ({
      name: checkRun.name,
      status: checkRun.status,
      conclusion: checkRun.conclusion,
      acceptedAsPassing:
        checkRun.conclusion !== null &&
        acceptedConclusions.has(checkRun.conclusion),
    }));
  const pendingChecks = checks.filter(
    (check) => check.conclusion === null || check.status !== "completed",
  ).length;
  const passingChecks = checks.filter((check) => check.acceptedAsPassing).length;
  const unsupportedChecks = checks.filter(
    (check) =>
      check.conclusion !== null &&
      !acceptedConclusions.has(check.conclusion) &&
      !["failure", "cancelled"].includes(check.conclusion),
  );
  const failedConclusionChecks = checks.filter((check) =>
    ["failure", "cancelled"].includes(check.conclusion ?? ""),
  );
  const reasons: string[] = [];

  if (checks.length === 0) {
    reasons.push("No CI checks were reported.");
  }
  if (pendingChecks > 0) {
    reasons.push(
      `${pendingChecks} CI check${pendingChecks === 1 ? " is" : "s are"} still pending.`,
    );
  }
  if (failedConclusionChecks.length > 0) {
    const cancelled = failedConclusionChecks.filter(
      (check) => check.conclusion === "cancelled",
    ).length;
    const failed = failedConclusionChecks.length - cancelled;
    if (failed > 0) {
      reasons.push(`${failed} CI check${failed === 1 ? " has" : "s have"} failed.`);
    }
    if (cancelled > 0) {
      reasons.push(
        `${cancelled} CI check${cancelled === 1 ? " is" : "s are"} cancelled.`,
      );
    }
  }
  if (unsupportedChecks.length > 0) {
    reasons.push(
      `${unsupportedChecks.length} CI check${unsupportedChecks.length === 1 ? " has" : "s have"} an unsupported conclusion.`,
    );
  }
  if (
    checks.length > 0 &&
    pendingChecks === 0 &&
    failedConclusionChecks.length === 0 &&
    unsupportedChecks.length === 0
  ) {
    reasons.push("All reported CI checks are passing or accepted as neutral/skipped.");
  }

  const passed =
    checks.length > 0 &&
    checks.every((check) => check.acceptedAsPassing);

  return {
    passed,
    decisionTrace: {
      passed,
      totalChecks: checks.length,
      passingChecks,
      pendingChecks,
      failedChecks: failedConclusionChecks.length + unsupportedChecks.length,
      checks,
      reasons,
    },
  };
}
