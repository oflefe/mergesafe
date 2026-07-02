import {
  PolicyFailure,
  ReviewComment,
  TestImpactResult,
  VerificationPolicy,
  VerificationPolicyRule,
  VerificationRequirement,
} from '../domain/types';

function hasHumanReview(reviewComments: ReviewComment[]): boolean {
  return reviewComments.some(
    (comment) => !/(coderabbit|copilot|claude|cursor|codex|bot)/i.test(comment.author),
  );
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob);
  let pattern = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const nextChar = normalized[index + 1];
    if (char === '*') {
      if (nextChar === '*') {
        pattern += '.*';
        index += 1;
      } else {
        pattern += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      pattern += '[^/]';
      continue;
    }
    if (/[-/\\^$+?.()|[\]{}]/.test(char)) {
      pattern += `\\${char}`;
      continue;
    }
    pattern += char;
  }
  pattern += '$';
  return new RegExp(pattern, 'i');
}

function matchesAnyPath(paths: string[], patterns: string[]): boolean {
  const regexes = patterns.map((pattern) => globToRegExp(pattern));
  return paths.some((path) => regexes.some((regex) => regex.test(normalizePath(path))));
}

function hasTestCategory(testImpact: TestImpactResult, category: string): boolean {
  const normalizedCategory = category.toLowerCase();
  if (normalizedCategory === 'integration' || normalizedCategory === 'e2e') {
    return testImpact.impactedTests.some((path) => /(integration|e2e)/i.test(path));
  }
  if (normalizedCategory === 'rollback') {
    return testImpact.impactedTests.some((path) => /rollback/i.test(path));
  }
  return testImpact.impactedTests.some((path) => path.toLowerCase().includes(normalizedCategory));
}

function describeRuleRequirements(rule: VerificationPolicyRule): string {
  const requirements: string[] = [];
  if (rule.require?.changedPaths?.length) {
    requirements.push(`changed paths matching ${rule.require.changedPaths.join(', ')}`);
  }
  if (rule.require?.tests?.length) {
    requirements.push(`test evidence from ${rule.require.tests.join(', ')}`);
  }
  if (rule.require?.review === 'human') {
    requirements.push('human review');
  }
  if (requirements.length === 0) {
    return '';
  }
  if (requirements.length === 1) {
    return requirements[0];
  }
  return `any of ${requirements.join(', ')}`;
}

function describeMissingRequirements(
  rule: VerificationPolicyRule,
  testImpact: TestImpactResult,
  changedPaths: string[],
  reviewComments: ReviewComment[],
): string[] {
  const missing: string[] = [];
  if (rule.require?.changedPaths?.length && !matchesAnyPath(changedPaths, rule.require.changedPaths)) {
    missing.push(`changed paths matching ${rule.require.changedPaths.join(', ')}`);
  }
  if (rule.require?.tests?.length && !rule.require.tests.some((testCategory) => hasTestCategory(testImpact, testCategory))) {
    missing.push(`test evidence from ${rule.require.tests.join(', ')}`);
  }
  if (rule.require?.review === 'human' && !hasHumanReview(reviewComments)) {
    missing.push('human review');
  }
  return missing;
}

export function evaluatePolicy(
  testImpact: TestImpactResult,
  reviewComments: ReviewComment[],
  changedPaths: string[],
  policy: VerificationPolicy,
): { policyFailures: PolicyFailure[]; verificationRequirements: VerificationRequirement[] } {
  const failures: PolicyFailure[] = [];
  const requirements: VerificationRequirement[] = [];
  for (const rule of policy.rules) {
    if (!matchesAnyPath(changedPaths, rule.when.paths)) {
      continue;
    }

    const requirementMessage = describeRuleRequirements(rule);
    requirements.push({
      code: rule.id,
      message: requirementMessage ? `${rule.message} Requires ${requirementMessage}.` : rule.message,
    });

    const missingRequirements = describeMissingRequirements(
      rule,
      testImpact,
      changedPaths,
      reviewComments,
    );
    const satisfiedBuckets = [
      rule.require?.changedPaths?.length
        ? matchesAnyPath(changedPaths, rule.require.changedPaths)
        : false,
      rule.require?.tests?.length
        ? rule.require.tests.some((testCategory) => hasTestCategory(testImpact, testCategory))
        : false,
      rule.require?.review === 'human' ? hasHumanReview(reviewComments) : false,
    ].some(Boolean);

    if (missingRequirements.length === 0 || rule.verdict === 'pass' || satisfiedBuckets) {
      continue;
    }

    const failureMessage = missingRequirements.length > 0
      ? `${rule.message} Missing ${missingRequirements.join(' and ')}.`
      : rule.message;
    failures.push({
      code: rule.id,
      verdict: rule.verdict,
      message: failureMessage,
    });
  }

  return { policyFailures: failures, verificationRequirements: requirements };
}
