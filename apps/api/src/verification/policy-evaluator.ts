import {
  RequirementMode,
  Verdict,
  PolicyFailure,
  ReviewComment,
  TestImpactResult,
  VerificationPolicy,
  VerificationPolicyRule,
  VerificationRequirement,
} from "../domain/types";

function hasHumanReview(reviewComments: ReviewComment[]): boolean {
  return reviewComments.some(
    (comment) =>
      !/(coderabbit|copilot|claude|cursor|codex|bot)/i.test(comment.author),
  );
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob);
  let pattern = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const nextChar = normalized[index + 1];
    if (char === "*") {
      if (nextChar === "*") {
        pattern += ".*";
        index += 1;
      } else {
        pattern += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      pattern += "[^/]";
      continue;
    }
    if (/[-/\\^$+?.()|[\]{}]/.test(char)) {
      pattern += `\\${char}`;
      continue;
    }
    pattern += char;
  }
  pattern += "$";
  return new RegExp(pattern, "i");
}

function matchesAnyPath(paths: string[], patterns: string[]): boolean {
  const regexes = patterns.map((pattern) => globToRegExp(pattern));
  return paths.some((path) =>
    regexes.some((regex) => regex.test(normalizePath(path))),
  );
}

function hasTestCategory(
  testImpact: TestImpactResult,
  category: string,
): boolean {
  const normalizedCategory = category.toLowerCase();
  if (normalizedCategory === "integration" || normalizedCategory === "e2e") {
    return testImpact.impactedTests.some((path) =>
      /(integration|e2e)/i.test(path),
    );
  }
  if (normalizedCategory === "rollback") {
    return testImpact.impactedTests.some((path) => /rollback/i.test(path));
  }
  return testImpact.impactedTests.some((path) =>
    path.toLowerCase().includes(normalizedCategory),
  );
}

function describeRuleRequirements(rule: VerificationPolicyRule): string {
  const requirements: string[] = [];
  if (rule.require?.changedPaths?.length) {
    requirements.push(
      `changed paths matching ${rule.require.changedPaths.join(", ")}`,
    );
  }
  if (rule.require?.tests?.length) {
    requirements.push(`test evidence from ${rule.require.tests.join(", ")}`);
  }
  if (rule.require?.review === "human") {
    requirements.push("human review");
  }
  if (requirements.length === 0) {
    return "";
  }
  if (requirements.length === 1) {
    return requirements[0];
  }
  const mode = rule.require?.mode ?? "all";
  return `${mode === "any" ? "any of" : "all of"} ${requirements.join(", ")}`;
}

function evaluateRequirementBuckets(
  rule: VerificationPolicyRule,
  testImpact: TestImpactResult,
  changedPaths: string[],
  reviewComments: ReviewComment[],
): Array<{ description: string; satisfied: boolean }> {
  const buckets: Array<{ description: string; satisfied: boolean }> = [];

  if (rule.require?.changedPaths?.length) {
    buckets.push({
      description: `changed paths matching ${rule.require.changedPaths.join(", ")}`,
      satisfied: matchesAnyPath(changedPaths, rule.require.changedPaths),
    });
  }
  if (rule.require?.tests?.length) {
    buckets.push({
      description: `test evidence from ${rule.require.tests.join(", ")}`,
      satisfied: rule.require.tests.some((testCategory) =>
        hasTestCategory(testImpact, testCategory),
      ),
    });
  }
  if (rule.require?.review === "human") {
    buckets.push({
      description: "human review",
      satisfied: hasHumanReview(reviewComments),
    });
  }

  return buckets;
}

function isPolicyRuleSatisfied(
  buckets: Array<{ description: string; satisfied: boolean }>,
  mode: RequirementMode,
): boolean {
  if (buckets.length === 0) {
    return false;
  }
  if (mode === "any") {
    return buckets.some((bucket) => bucket.satisfied);
  }
  return buckets.every((bucket) => bucket.satisfied);
}

function describeMissingRequirements(
  buckets: Array<{ description: string; satisfied: boolean }>,
  mode: RequirementMode,
): string[] {
  if (mode === "any") {
    return buckets.some((bucket) => bucket.satisfied)
      ? []
      : buckets.map((bucket) => bucket.description);
  }
  return buckets
    .filter((bucket) => !bucket.satisfied)
    .map((bucket) => bucket.description);
}

export function evaluatePolicy(
  testImpact: TestImpactResult,
  reviewComments: ReviewComment[],
  changedPaths: string[],
  policy: VerificationPolicy,
): {
  policyFailures: PolicyFailure[];
  verificationRequirements: VerificationRequirement[];
} {
  const failures: PolicyFailure[] = [];
  const requirements: VerificationRequirement[] = [];
  for (const rule of policy.rules) {
    if (!matchesAnyPath(changedPaths, rule.when.paths)) {
      continue;
    }

    const requirementMessage = describeRuleRequirements(rule);
    requirements.push({
      code: rule.id,
      message: requirementMessage
        ? `${rule.message} Requires ${requirementMessage}.`
        : rule.message,
    });

    const requirementMode = rule.require?.mode ?? "all";
    const requirementBuckets = evaluateRequirementBuckets(
      rule,
      testImpact,
      changedPaths,
      reviewComments,
    );
    const missingRequirements = describeMissingRequirements(
      requirementBuckets,
      requirementMode,
    );
    const satisfied = isPolicyRuleSatisfied(
      requirementBuckets,
      requirementMode,
    );

    if (
      missingRequirements.length === 0 ||
      rule.verdict === Verdict.PASS ||
      satisfied
    ) {
      continue;
    }

    const failureMessage =
      missingRequirements.length > 0
        ? `${rule.message} Missing ${missingRequirements.join(" and ")}.`
        : rule.message;
    failures.push({
      code: rule.id,
      verdict: rule.verdict,
      message: failureMessage,
    });
  }

  return { policyFailures: failures, verificationRequirements: requirements };
}
