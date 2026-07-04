import {
  safeDocsPr,
  riskyAuthPr,
  dependencyUpdatePr,
  agentLookingPr,
} from "../../test/fixtures/pull-request.fixtures";
import { PolicyLoader } from "./policy-loader";
import { scoreRisk } from "./risk-scoring";
import { mapImpactedTests } from "./test-impact";

describe("scoreRisk", () => {
  const policy = new PolicyLoader().load();

  it("keeps docs-only changes low risk", () => {
    const testImpact = mapImpactedTests(
      safeDocsPr.changedFiles,
      safeDocsPr.repositoryFiles,
    );
    const result = scoreRisk(safeDocsPr, policy, testImpact);

    expect(result.riskScore).toBeLessThanOrEqual(8);
    expect(result.riskFindings).toHaveLength(0);
  });

  it("flags auth changes without nearby tests as high risk", () => {
    const testImpact = mapImpactedTests(
      riskyAuthPr.changedFiles,
      riskyAuthPr.repositoryFiles,
    );
    const result = scoreRisk(riskyAuthPr, policy, testImpact);

    expect(result.likelyAgentAuthored).toBe(true);
    expect(result.riskScore).toBeGreaterThanOrEqual(70);
    expect(result.riskFindings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["auth", "missing-tests", "agent-authored"]),
    );
  });

  it("captures dependency updates and agent-looking broad diffs", () => {
    const deps = scoreRisk(
      dependencyUpdatePr,
      policy,
      mapImpactedTests(
        dependencyUpdatePr.changedFiles,
        dependencyUpdatePr.repositoryFiles,
      ),
    );
    expect(deps.riskFindings.map((finding) => finding.code)).toContain(
      "dependencyLockfile",
    );

    const agent = scoreRisk(
      agentLookingPr,
      policy,
      mapImpactedTests(
        agentLookingPr.changedFiles,
        agentLookingPr.repositoryFiles,
      ),
    );
    expect(agent.riskFindings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["agent-authored", "large-pr", "generated-text"]),
    );
  });

  it("does not flag campaign branch as agent-authored", () => {
    const request = {
      ...safeDocsPr,
      branchName: "campaign-update",
      changedFiles: [
        { path: "src/feature/banner.ts", additions: 8, deletions: 2 },
      ],
      repositoryFiles: {
        "src/feature/banner.ts": "export const banner = true;",
      },
    };

    const result = scoreRisk(
      request,
      policy,
      mapImpactedTests(request.changedFiles, request.repositoryFiles),
    );

    expect(result.likelyAgentAuthored).toBe(false);
    expect(result.riskFindings.map((finding) => finding.code)).not.toContain(
      "agent-authored",
    );
  });

  it("flags copilot bot author as agent-authored", () => {
    const request = {
      ...safeDocsPr,
      author: "copilot-swe-agent[bot]",
      changedFiles: [
        { path: "src/core/service.ts", additions: 16, deletions: 3 },
      ],
      repositoryFiles: {
        "src/core/service.ts": "export const run = () => true;",
      },
    };

    const result = scoreRisk(
      request,
      policy,
      mapImpactedTests(request.changedFiles, request.repositoryFiles),
    );

    expect(result.likelyAgentAuthored).toBe(true);
    expect(result.riskFindings.map((finding) => finding.code)).toContain(
      "agent-authored",
    );
  });

  it("increases risk when tests are deleted", () => {
    const request = {
      ...safeDocsPr,
      changedFiles: [
        {
          path: "tests/auth/session.spec.ts",
          status: "removed",
          additions: 0,
          deletions: 40,
        },
        { path: "src/auth/session.ts", additions: 12, deletions: 2 },
      ],
      repositoryFiles: {
        "src/auth/session.ts": "export const session = () => true;",
      },
    };

    const result = scoreRisk(
      request,
      policy,
      mapImpactedTests(request.changedFiles, request.repositoryFiles),
    );

    expect(result.riskFindings.map((finding) => finding.code)).toContain(
      "deleted-tests",
    );
  });

  it("increases risk when skipped tests are introduced", () => {
    const request = {
      ...safeDocsPr,
      changedFiles: [
        {
          path: "tests/auth/session.spec.ts",
          additions: 2,
          deletions: 0,
          patch:
            '@@ -1,2 +1,4 @@\n+describe.skip("session", () => {})\n+it.skip("works", () => {})',
        },
      ],
      repositoryFiles: {
        "tests/auth/session.spec.ts": 'describe.skip("session", () => {});',
      },
    };

    const result = scoreRisk(
      request,
      policy,
      mapImpactedTests(request.changedFiles, request.repositoryFiles),
    );

    expect(result.riskFindings.map((finding) => finding.code)).toContain(
      "skipped-tests",
    );
  });
});
