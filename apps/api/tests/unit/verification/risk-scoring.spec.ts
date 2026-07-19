import {
  safeDocsPr,
  riskyAuthPr,
  dependencyUpdatePr,
  agentLookingPr,
} from "../../fixtures/pull-request.fixtures";
import { PolicyLoader } from "../../../src/verification/policy-loader";
import { scoreRisk } from "../../../src/verification/risk-scoring";
import { mapImpactedTests } from "../../../src/verification/test-impact";

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

  it("GIVEN categorized and uncategorized changes WHEN scoring risk THEN only unmatched non-doc files are diagnosed", () => {
    const request = {
      ...safeDocsPr,
      changedFiles: [
        { path: "src/zeta/profile.ts", additions: 4, deletions: 1 },
        { path: "src/auth/session.ts", additions: 4, deletions: 1 },
        { path: "src/payment/checkout.ts", additions: 4, deletions: 1 },
        { path: "src/zeta/profile.ts", additions: 2, deletions: 0 },
        { path: "README.md", additions: 1, deletions: 0 },
      ],
      repositoryFiles: {
        "src/zeta/profile.ts": "export const profile = true;",
        "src/auth/session.ts": "export const session = true;",
        "src/payment/checkout.ts": "export const checkout = true;",
      },
    };
    const result = scoreRisk(
      request,
      policy,
      mapImpactedTests(request.changedFiles, request.repositoryFiles),
    );

    expect(result.uncategorizedFiles).toEqual(["src/zeta/profile.ts"]);
    expect(result.riskFindings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["auth", "payment", "missing-tests"]),
    );
  });

  it("GIVEN only uncategorized files with mapped tests WHEN scoring risk THEN diagnostics do not change risk", () => {
    const request = {
      ...safeDocsPr,
      changedFiles: [
        { path: "src/profile.ts", additions: 4, deletions: 1 },
      ],
      repositoryFiles: {
        "src/profile.ts": "export const profile = true;",
        "tests/profile.spec.ts": "describe('profile', () => {});",
      },
    };
    const testImpact = mapImpactedTests(
      request.changedFiles,
      request.repositoryFiles,
    );
    const result = scoreRisk(request, policy, testImpact);

    expect(result.uncategorizedFiles).toEqual(["src/profile.ts"]);
    expect(result.riskScore).toBe(0);
    expect(result.riskFindings).toEqual([]);
  });
});
