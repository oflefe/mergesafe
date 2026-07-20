import {
  CiDecisionTrace,
  PolicyFailure,
  RiskLevel,
  Verdict,
  VerdictDecisionTrace,
  VerdictReason,
} from "../domain/types";

function policyReason(failure: PolicyFailure): VerdictReason {
  const isFailure = failure.verdict === Verdict.FAIL;
  return {
    code: isFailure ? "policy-failure" : "policy-review",
    message: failure.message,
    source: "policy",
    severity: isFailure ? "failure" : "review",
  };
}

export function evaluateVerdict(input: {
  riskLevel: RiskLevel;
  policyFailures: PolicyFailure[];
  ci: CiDecisionTrace;
}): VerdictDecisionTrace {
  const reasons: VerdictReason[] = input.policyFailures.map(policyReason);
  const hasPolicyFailure = input.policyFailures.some(
    (failure) => failure.verdict === Verdict.FAIL,
  );
  const hasPolicyReview = input.policyFailures.some(
    (failure) => failure.verdict === Verdict.NEEDS_REVIEW,
  );

  if (input.riskLevel === RiskLevel.CRITICAL) {
    reasons.push({
      code: "critical-risk",
      message: "The calculated PR risk level is CRITICAL.",
      source: "risk",
      severity: "failure",
    });
  } else if (input.riskLevel === RiskLevel.HIGH) {
    reasons.push({
      code: "high-risk",
      message: "The calculated PR risk level is HIGH.",
      source: "risk",
      severity: "review",
    });
  } else if (input.riskLevel === RiskLevel.MEDIUM) {
    reasons.push({
      code: "medium-risk",
      message: "The calculated PR risk level is MEDIUM.",
      source: "risk",
      severity: "review",
    });
  }

  if (!input.ci.passed) {
    reasons.push({
      code: "ci-not-green",
      message: "Existing CI checks are not all passing.",
      source: "ci",
      severity: "review",
    });
  }

  const verdict =
    hasPolicyFailure || input.riskLevel === RiskLevel.CRITICAL
      ? Verdict.FAIL
      : hasPolicyReview ||
          !input.ci.passed ||
          input.riskLevel === RiskLevel.HIGH ||
          input.riskLevel === RiskLevel.MEDIUM
        ? Verdict.NEEDS_REVIEW
        : Verdict.PASS;
  const checkConclusion =
    hasPolicyFailure || input.riskLevel === RiskLevel.CRITICAL
      ? "failure"
      : verdict === Verdict.PASS
        ? "success"
        : "neutral";

  return { verdict, checkConclusion, reasons };
}
