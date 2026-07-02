import {
  PolicyFailure,
  ReviewComment,
  RiskFinding,
  TestImpactResult,
  VerificationPolicy,
  VerificationRequirement,
} from '../domain/types';

function hasHumanReview(reviewComments: ReviewComment[]): boolean {
  return reviewComments.some(
    (comment) => !/(coderabbit|copilot|claude|cursor|codex|bot)/i.test(comment.author),
  );
}

export function evaluatePolicy(
  riskFindings: RiskFinding[],
  testImpact: TestImpactResult,
  reviewComments: ReviewComment[],
  changedPaths: string[],
  policy: VerificationPolicy,
): { policyFailures: PolicyFailure[]; verificationRequirements: VerificationRequirement[] } {
  const failures: PolicyFailure[] = [];
  const requirements: VerificationRequirement[] = [];
  const hasFinding = (code: string) => riskFindings.some((finding) => finding.code === code);
  const hasDocsUpdate = changedPaths.some((path) => /(^docs\/|\/docs\/|readme|changelog|\.mdx?$)/i.test(path));
  const impactedIntegrationTests = testImpact.impactedTests.filter((path) =>
    /(integration|e2e)/i.test(path),
  );
  const impactedRollbackTests = testImpact.impactedTests.filter((path) => /rollback/i.test(path));

  if (policy.hardRules.authChangeRequiresIntegrationTest && hasFinding('auth')) {
    requirements.push({
      code: 'auth-integration-test',
      message: 'Auth/session changes require an integration or e2e test before merge.',
    });
    if (impactedIntegrationTests.length === 0) {
      failures.push({
        code: 'auth-integration-test-missing',
        message: 'Auth/session changes were detected without an integration or e2e test.',
      });
    }
  }

  if (policy.hardRules.migrationRequiresRollbackTest && hasFinding('migration')) {
    requirements.push({
      code: 'migration-rollback-test',
      message: 'Database migrations require a rollback-oriented verification step.',
    });
    if (impactedRollbackTests.length === 0) {
      failures.push({
        code: 'migration-rollback-test-missing',
        message: 'Migration changes were detected without a rollback test.',
      });
    }
  }

  if (policy.hardRules.envChangeRequiresDocsUpdate && hasFinding('env')) {
    requirements.push({
      code: 'env-docs-update',
      message: 'Configuration changes require a docs update describing the new behavior.',
    });
    if (!hasDocsUpdate) {
      failures.push({
        code: 'env-docs-update-missing',
        message: 'Config/environment changes were detected without a docs update.',
      });
    }
  }

  if (policy.hardRules.paymentChangeRequiresManualReviewer && hasFinding('payment')) {
    requirements.push({
      code: 'payment-manual-review',
      message: 'Payment changes require explicit manual reviewer involvement.',
    });
    if (!hasHumanReview(reviewComments)) {
      failures.push({
        code: 'payment-manual-review-missing',
        message: 'Payment changes were detected without evidence of human review.',
      });
    }
  }

  return { policyFailures: failures, verificationRequirements: requirements };
}
