import { VerificationRepository } from "./verification.repository";
import { safeDocsPr } from "../../test/fixtures/pull-request.fixtures";
import { VerificationResult } from "../domain/types";
import { createTestDatabaseClient } from "../../test/helpers/create-test-database";
import { DatabaseClient, DatabaseTransactionClient } from "./database.pool";

describe("VerificationRepository", () => {
  it("GIVEN a verification request WHEN upserting THEN it stores repository and pull request", async () => {
    const database = createTestDatabaseClient();
    const repository = new VerificationRepository(database);

    const record = await repository.upsertFromRequest(safeDocsPr);

    expect(record.id).toBe("octo/demo#1");
    expect(record.repoOwner).toBe("octo");
    expect(record.repoName).toBe("demo");

    const repositories = await repository.listRepositories();
    const pullRequests = await repository.listPullRequests("octo/demo");

    expect(repositories).toEqual([
      { id: "octo/demo", owner: "octo", name: "demo" },
    ]);
    expect(pullRequests).toHaveLength(1);
    expect(pullRequests[0].headSha).toBe("aaa0000001");
  });

  it("GIVEN an upserted pull request WHEN saving verification result THEN it persists run and evidence rows", async () => {
    const database = createTestDatabaseClient();
    const repository = new VerificationRepository(database);

    const pr = await repository.upsertFromRequest(safeDocsPr);
    const result: VerificationResult = {
      pullRequestId: pr.id,
      repoId: safeDocsPr.repoId,
      riskScore: 62,
      riskFindings: [
        { code: "missing-tests", weight: 25, reason: "No tests changed" },
      ],
      testImpact: {
        impactedTests: ["tests/auth/session.spec.ts"],
        missingTestCoverage: ["src/auth/session.ts"],
        suggestedCommands: ["npm test"],
      },
      policyFailures: [
        {
          code: "manual-review-required",
          verdict: "fail",
          message: "Manual review required for auth changes.",
        },
      ],
      verificationRequirements: [
        { code: "add-tests", message: "Add missing tests." },
      ],
      externalReviewFindings: [
        { source: "copilot-review", author: "bot", body: "Please add tests." },
      ],
      ciPassed: false,
      ciSummary: "CI is failing.",
      likelyAgentAuthored: true,
      commentBody: "Verification summary",
      verdict: "fail",
      checkConclusion: "failure",
    };

    const updated = await repository.saveVerificationResult(
      pr.id,
      result,
      safeDocsPr,
      991,
      881,
    );

    expect(updated.commentId).toBe(991);
    expect(updated.checkRunId).toBe(881);
    expect(updated.latestVerificationRunId).toBeDefined();
    expect(updated.latestVerification?.riskScore).toBe(62);

    const runId = updated.latestVerificationRunId as number;
    const changedFiles = await database.query(
      "SELECT id FROM changed_files WHERE verification_run_id = $1",
      [runId],
    );
    const riskFindings = await database.query(
      "SELECT id FROM risk_findings WHERE verification_run_id = $1",
      [runId],
    );
    const requirements = await database.query(
      "SELECT id FROM verification_requirements WHERE verification_run_id = $1",
      [runId],
    );
    const snapshots = await database.query(
      "SELECT id FROM check_run_snapshots WHERE verification_run_id = $1",
      [runId],
    );
    const findings = await database.query(
      "SELECT id FROM external_review_findings WHERE verification_run_id = $1",
      [runId],
    );

    expect(changedFiles.rowCount).toBe(1);
    expect(riskFindings.rowCount).toBe(1);
    expect(requirements.rowCount).toBe(1);
    expect(snapshots.rowCount).toBe(1);
    expect(findings.rowCount).toBe(1);
  });

  it("GIVEN persisted comment id WHEN loading from a new repository instance THEN comment id is preserved", async () => {
    const database = createTestDatabaseClient();
    const first = new VerificationRepository(database);
    const second = new VerificationRepository(database);

    const pr = await first.upsertFromRequest(safeDocsPr);
    const result: VerificationResult = {
      pullRequestId: pr.id,
      repoId: safeDocsPr.repoId,
      riskScore: 10,
      riskFindings: [],
      testImpact: {
        impactedTests: [],
        missingTestCoverage: [],
        suggestedCommands: [],
      },
      policyFailures: [],
      verificationRequirements: [],
      externalReviewFindings: [],
      ciPassed: true,
      ciSummary: "ok",
      likelyAgentAuthored: false,
      commentBody: "ok",
      verdict: "pass",
      checkConclusion: "success",
    };

    await first.saveVerificationResult(pr.id, result, safeDocsPr, 77, 66);

    const loaded = await second.getPullRequest(pr.id);

    expect(loaded?.commentId).toBe(77);
    expect(loaded?.checkRunId).toBe(66);
    expect(loaded?.latestVerification?.verdict).toBe("pass");
  });

  it("GIVEN a query failure after run insert WHEN saving verification result THEN transaction rolls back all writes", async () => {
    const baseDatabase = createTestDatabaseClient();
    const failingDatabase = createFailingDatabaseClient(
      baseDatabase,
      /INSERT INTO changed_files/,
    );
    const repository = new VerificationRepository(failingDatabase);

    const pr = await repository.upsertFromRequest(safeDocsPr);
    const result: VerificationResult = {
      pullRequestId: pr.id,
      repoId: safeDocsPr.repoId,
      riskScore: 50,
      riskFindings: [{ code: "missing-tests", weight: 20, reason: "No tests" }],
      testImpact: {
        impactedTests: ["tests/a.spec.ts"],
        missingTestCoverage: ["src/a.ts"],
        suggestedCommands: ["npm test"],
      },
      policyFailures: [],
      verificationRequirements: [{ code: "add-tests", message: "Add tests" }],
      externalReviewFindings: [
        { source: "copilot-review", author: "bot", body: "missing tests" },
      ],
      ciPassed: false,
      ciSummary: "ci pending",
      likelyAgentAuthored: true,
      commentBody: "body",
      verdict: "neutral",
      checkConclusion: "neutral",
    };

    await expect(
      repository.saveVerificationResult(pr.id, result, safeDocsPr, 321, 654),
    ).rejects.toThrow("simulated changed files insert failure");

    const changedFiles = await baseDatabase.query(
      "SELECT id FROM changed_files",
    );
    const updatedPr = await baseDatabase.query(
      "SELECT latest_verification_run_id FROM pull_requests WHERE id = $1",
      [pr.id],
    );

    expect(changedFiles.rowCount).toBe(0);
    expect(updatedPr.rows[0].latest_verification_run_id).toBeNull();
  });
});

function createFailingDatabaseClient(
  base: DatabaseClient,
  failingSql: RegExp,
): DatabaseClient {
  return {
    query: base.query.bind(base),
    close: base.close.bind(base),
    transaction: async <T>(
      operation: (client: DatabaseTransactionClient) => Promise<T>,
    ): Promise<T> => {
      return base.transaction(async (client) => {
        const wrappedClient: DatabaseTransactionClient = {
          query: async (text, params) => {
            if (failingSql.test(text)) {
              throw new Error("simulated changed files insert failure");
            }
            return client.query(text, params);
          },
        };
        return operation(wrappedClient);
      });
    },
  };
}
