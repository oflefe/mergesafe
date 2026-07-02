import { evaluatePolicy } from './policy-evaluator';
import { PolicyLoader } from './policy-loader';
import { mapImpactedTests } from './test-impact';
import { scoreRisk } from './risk-scoring';
import { migrationPr, riskyAuthPr } from '../../test/fixtures/pull-request.fixtures';

describe('evaluatePolicy', () => {
  const policy = new PolicyLoader().load();

  it('fails auth changes without integration coverage', () => {
    const testImpact = mapImpactedTests(riskyAuthPr.changedFiles, riskyAuthPr.repositoryFiles, riskyAuthPr.repositoryScripts);
    const risk = scoreRisk(riskyAuthPr, policy, testImpact);
    const result = evaluatePolicy(
      risk.riskFindings,
      testImpact,
      riskyAuthPr.reviewComments,
      riskyAuthPr.changedFiles.map((file) => file.path),
      policy,
    );

    expect(result.policyFailures.map((failure) => failure.code)).toContain('auth-integration-test-missing');
  });

  it('fails migrations without rollback coverage', () => {
    const testImpact = mapImpactedTests(migrationPr.changedFiles, migrationPr.repositoryFiles, migrationPr.repositoryScripts);
    const risk = scoreRisk(migrationPr, policy, testImpact);
    const result = evaluatePolicy(
      risk.riskFindings,
      testImpact,
      migrationPr.reviewComments,
      migrationPr.changedFiles.map((file) => file.path),
      policy,
    );

    expect(result.policyFailures.map((failure) => failure.code)).toContain('migration-rollback-test-missing');
  });
});
