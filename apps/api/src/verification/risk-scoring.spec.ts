import { safeDocsPr, riskyAuthPr, dependencyUpdatePr, agentLookingPr } from '../../test/fixtures/pull-request.fixtures';
import { PolicyLoader } from './policy-loader';
import { scoreRisk } from './risk-scoring';
import { mapImpactedTests } from './test-impact';

describe('scoreRisk', () => {
  const policy = new PolicyLoader().load();

  it('keeps docs-only changes low risk', () => {
    const testImpact = mapImpactedTests(safeDocsPr.changedFiles, safeDocsPr.repositoryFiles, safeDocsPr.repositoryScripts);
    const result = scoreRisk(safeDocsPr, policy, testImpact);

    expect(result.riskScore).toBeLessThanOrEqual(8);
    expect(result.riskFindings).toHaveLength(0);
  });

  it('flags auth changes without nearby tests as high risk', () => {
    const testImpact = mapImpactedTests(riskyAuthPr.changedFiles, riskyAuthPr.repositoryFiles, riskyAuthPr.repositoryScripts);
    const result = scoreRisk(riskyAuthPr, policy, testImpact);

    expect(result.likelyAgentAuthored).toBe(true);
    expect(result.riskScore).toBeGreaterThanOrEqual(70);
    expect(result.riskFindings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['auth', 'missing-tests', 'agent-authored']),
    );
  });

  it('captures dependency updates and agent-looking broad diffs', () => {
    const deps = scoreRisk(
      dependencyUpdatePr,
      policy,
      mapImpactedTests(
        dependencyUpdatePr.changedFiles,
        dependencyUpdatePr.repositoryFiles,
        dependencyUpdatePr.repositoryScripts,
      ),
    );
    expect(deps.riskFindings.map((finding) => finding.code)).toContain('dependencyLockfile');

    const agent = scoreRisk(
      agentLookingPr,
      policy,
      mapImpactedTests(agentLookingPr.changedFiles, agentLookingPr.repositoryFiles, agentLookingPr.repositoryScripts),
    );
    expect(agent.riskFindings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['agent-authored', 'large-pr', 'generated-text']),
    );
  });
});
