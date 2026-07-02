import { evaluatePolicy } from './policy-evaluator';
import { PolicyLoader } from './policy-loader';
import { mapImpactedTests } from './test-impact';
import { Verdict } from '../domain/types';
import {
  safeDocsPr,
  riskyAuthPr,
  migrationPr,
} from '../../test/fixtures/pull-request.fixtures';

const policyText = `
version: 1
rules:
  - id: auth-requires-integration-test
    when:
      paths:
        - "src/auth/**"
        - "src/middleware/**"
    require:
      tests:
        - "integration"
        - "e2e"
    verdict: fail
    message: "Auth or middleware changes require integration test evidence."
  - id: migration-requires-rollback-evidence
    when:
      paths:
        - "prisma/migrations/**"
        - "src/db/**"
    require:
      changedPaths:
        - "docs/rollback.md"
      tests:
        - "rollback"
    verdict: fail
    message: "Migration changes require rollback docs or rollback test evidence."
  - id: env-requires-docs
    when:
      paths:
        - "src/config/**"
        - "src/env/**"
    require:
      changedPaths:
        - "docs/**"
        - "README.md"
    verdict: fail
    message: "Env/config changes require docs."
  - id: payment-requires-human-review
    when:
      paths:
        - "src/payment/**"
    require:
      review: human
    verdict: needs_review
    message: "Payment changes require human review."
`;

function loadPolicy() {
  return new PolicyLoader().load(policyText);
}

describe('evaluatePolicy', () => {
  it('fails auth changes without integration or e2e evidence', () => {
    const policy = loadPolicy();
    const testImpact = mapImpactedTests(
      riskyAuthPr.changedFiles,
      riskyAuthPr.repositoryFiles,
    );

    const result = evaluatePolicy(
      testImpact,
      riskyAuthPr.reviewComments,
      riskyAuthPr.changedFiles.map((file) => file.path),
      policy,
    );

    expect(result.policyFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'auth-requires-integration-test',
          verdict: Verdict.FAIL,
        }),
      ]),
    );
  });

  it('fails auth changes when only unit tests are present', () => {
    const policy = loadPolicy();
    const request = {
      ...riskyAuthPr,
      changedFiles: [
        ...riskyAuthPr.changedFiles,
        { path: 'tests/auth/session.spec.ts', additions: 20, deletions: 0 },
      ],
      repositoryFiles: {
        ...riskyAuthPr.repositoryFiles,
        'tests/auth/session.spec.ts':
          "import { guard } from '../../src/auth/permission.guard';\ndescribe('guard', () => { it('works', () => guard()); });",
      },
    };
    const testImpact = mapImpactedTests(
      request.changedFiles,
      request.repositoryFiles,
    );

    const result = evaluatePolicy(
      testImpact,
      request.reviewComments,
      request.changedFiles.map((file) => file.path),
      policy,
    );

    expect(result.policyFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'auth-requires-integration-test',
          verdict: Verdict.FAIL,
        }),
      ]),
    );
  });

  it('accepts migration docs evidence without a rollback test', () => {
    const policy = loadPolicy();
    const request = {
      ...migrationPr,
      changedFiles: [
        ...migrationPr.changedFiles,
        { path: 'docs/rollback.md', additions: 5, deletions: 0 },
      ],
    };
    const testImpact = mapImpactedTests(
      request.changedFiles,
      request.repositoryFiles,
    );

    const result = evaluatePolicy(
      testImpact,
      request.reviewComments,
      request.changedFiles.map((file) => file.path),
      policy,
    );

    expect(result.policyFailures.map((failure) => failure.code)).not.toContain(
      'migration-requires-rollback-evidence',
    );
  });

  it('accepts migration rollback test evidence without docs', () => {
    const policy = loadPolicy();
    const request = {
      ...migrationPr,
      changedFiles: [
        ...migrationPr.changedFiles,
        { path: 'tests/rollback/migration.rollback.test.ts', additions: 20, deletions: 0 },
      ],
      repositoryFiles: {
        ...migrationPr.repositoryFiles,
        'tests/rollback/migration.rollback.test.ts': 'describe("rollback", () => {});',
      },
    };
    const testImpact = mapImpactedTests(
      request.changedFiles,
      request.repositoryFiles,
    );

    const result = evaluatePolicy(
      testImpact,
      request.reviewComments,
      request.changedFiles.map((file) => file.path),
      policy,
    );

    expect(result.policyFailures.map((failure) => failure.code)).not.toContain(
      'migration-requires-rollback-evidence',
    );
  });

  it('fails env changes without docs updates', () => {
    const policy = loadPolicy();
    const request = {
      ...safeDocsPr,
      changedFiles: [{ path: 'src/config/settings.ts', additions: 14, deletions: 3 }],
      repositoryFiles: {
        'src/config/settings.ts': 'export const settings = {};',
      },
    };
    const testImpact = mapImpactedTests(
      request.changedFiles,
      request.repositoryFiles,
    );

    const result = evaluatePolicy(
      testImpact,
      request.reviewComments,
      request.changedFiles.map((file) => file.path),
      policy,
    );

    expect(result.policyFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'env-requires-docs',
          verdict: Verdict.FAIL,
        }),
      ]),
    );
  });

  it('requires human review for payment changes', () => {
    const policy = loadPolicy();
    const request = {
      ...safeDocsPr,
      changedFiles: [{ path: 'src/payment/checkout.ts', additions: 24, deletions: 4 }],
      repositoryFiles: {
        'src/payment/checkout.ts': 'export const charge = () => true;',
      },
    };
    const testImpact = mapImpactedTests(
      request.changedFiles,
      request.repositoryFiles,
    );

    const result = evaluatePolicy(
      testImpact,
      request.reviewComments,
      request.changedFiles.map((file) => file.path),
      policy,
    );

    expect(result.policyFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'payment-requires-human-review',
          verdict: Verdict.NEEDS_REVIEW,
        }),
      ]),
    );
  });

  it('does nothing for nonmatching rules', () => {
    const policy = loadPolicy();
    const request = {
      ...safeDocsPr,
      changedFiles: [{ path: 'src/ui/button.ts', additions: 8, deletions: 2 }],
      repositoryFiles: {
        'src/ui/button.ts': 'export const button = true;',
      },
    };
    const testImpact = mapImpactedTests(
      request.changedFiles,
      request.repositoryFiles,
    );

    const result = evaluatePolicy(
      testImpact,
      request.reviewComments,
      request.changedFiles.map((file) => file.path),
      policy,
    );

    expect(result.policyFailures).toHaveLength(0);
    expect(result.verificationRequirements).toHaveLength(0);
  });
});
