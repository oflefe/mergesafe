import { Inject, Injectable } from "@nestjs/common";
import {
  PullRequestRecord,
  RepositoryRecord,
  VerificationRequest,
  VerificationResult,
} from "../domain/types";
import {
  DATABASE_CLIENT,
  DatabaseClient,
  DatabaseQueryClient,
} from "./database.pool";

@Injectable()
export class VerificationRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClient,
  ) {}

  async upsertFromRequest(
    request: VerificationRequest,
  ): Promise<PullRequestRecord> {
    const repoId = request.repoId || `${request.repoOwner}/${request.repoName}`;
    await this.database.query(
      `INSERT INTO repositories (id, owner, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner, name = EXCLUDED.name`,
      [repoId, request.repoOwner, request.repoName],
    );

    const pullRequestId = `${repoId}#${request.pullNumber}`;
    await this.database.query(
      `INSERT INTO pull_requests (
        id,
        repository_id,
        pull_number,
        title,
        body,
        author,
        branch_name,
        base_branch,
        head_sha,
        state,
        installation_id,
        github_pull_request_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        author = EXCLUDED.author,
        branch_name = EXCLUDED.branch_name,
        base_branch = EXCLUDED.base_branch,
        head_sha = EXCLUDED.head_sha,
        state = 'open',
        installation_id = EXCLUDED.installation_id,
        github_pull_request_id = EXCLUDED.github_pull_request_id,
        updated_at = NOW()`,
      [
        pullRequestId,
        repoId,
        request.pullNumber,
        request.title,
        request.body,
        request.author,
        request.branchName,
        request.baseBranch,
        request.headSha,
        request.installationId ?? null,
        request.pullRequestId ?? null,
      ],
    );

    const record = await this.getPullRequest(pullRequestId);
    if (!record) {
      throw new Error(`Unable to upsert pull request ${pullRequestId}`);
    }
    return record;
  }

  async saveVerificationResult(
    pullRequestId: string,
    result: VerificationResult,
    request: VerificationRequest,
    commentId?: number,
    checkRunId?: number,
  ): Promise<PullRequestRecord> {
    const existing = await this.getPullRequest(pullRequestId);
    if (!existing?.id) {
      throw new Error(`Unknown pull request ${pullRequestId}`);
    }

    await this.database.transaction(async (client) => {
      const runId = await this.insertVerificationRun(
        client,
        pullRequestId,
        request,
        result,
      );
      await this.persistChangedFiles(client, runId, request);
      await this.persistRiskFindings(client, runId, result);
      await this.persistVerificationRequirements(client, runId, result);
      await this.persistCheckRunSnapshots(client, runId, request);
      await this.persistExternalReviewFindings(client, runId, result);
      await this.upsertPolicy(client, request.repoId, request.policyText);
      await this.updatePullRequestLatestState(
        client,
        pullRequestId,
        request,
        result,
        runId,
        commentId,
        checkRunId,
      );
    });

    const updated = await this.getPullRequest(pullRequestId);
    if (!updated) {
      throw new Error(`Unable to load updated pull request ${pullRequestId}`);
    }
    return updated;
  }

  async listRepositories(): Promise<RepositoryRecord[]> {
    const result = await this.database.query<RepositoryRecord>(
      "SELECT id, owner, name FROM repositories ORDER BY id",
    );
    return result.rows;
  }

  async listPullRequests(repoId: string): Promise<PullRequestRecord[]> {
    const result = await this.database.query<PullRequestRow>(
      `SELECT
        pr.id,
        pr.repository_id,
        r.owner,
        r.name,
        pr.pull_number,
        pr.title,
        pr.body,
        pr.author,
        pr.branch_name,
        pr.base_branch,
        pr.head_sha,
        pr.state,
        pr.installation_id,
        pr.github_pull_request_id,
        pr.risk_score,
        pr.verdict,
        pr.latest_comment_id,
        pr.latest_check_run_id,
        pr.latest_verification_run_id,
        vr.result_json,
        vr.request_json
      FROM pull_requests pr
      INNER JOIN repositories r ON r.id = pr.repository_id
      LEFT JOIN verification_runs vr ON vr.id = pr.latest_verification_run_id
      WHERE pr.repository_id = $1
      ORDER BY pr.updated_at DESC`,
      [repoId],
    );
    return result.rows.map((row) => this.mapPullRequestRow(row));
  }

  async getPullRequest(
    pullRequestId: string,
  ): Promise<PullRequestRecord | undefined> {
    const result = await this.database.query<PullRequestRow>(
      `SELECT
        pr.id,
        pr.repository_id,
        r.owner,
        r.name,
        pr.pull_number,
        pr.title,
        pr.body,
        pr.author,
        pr.branch_name,
        pr.base_branch,
        pr.head_sha,
        pr.state,
        pr.installation_id,
        pr.github_pull_request_id,
        pr.risk_score,
        pr.verdict,
        pr.latest_comment_id,
        pr.latest_check_run_id,
        pr.latest_verification_run_id,
        vr.result_json,
        vr.request_json
      FROM pull_requests pr
      INNER JOIN repositories r ON r.id = pr.repository_id
      LEFT JOIN verification_runs vr ON vr.id = pr.latest_verification_run_id
      WHERE pr.id = $1`,
      [pullRequestId],
    );
    const row = result.rows[0];
    return row ? this.mapPullRequestRow(row) : undefined;
  }

  private async insertVerificationRun(
    client: DatabaseQueryClient,
    pullRequestId: string,
    request: VerificationRequest,
    result: VerificationResult,
  ): Promise<number> {
    const runInsert = await client.query<{ id: number }>(
      `INSERT INTO verification_runs (pull_request_id, request_json, result_json)
       VALUES ($1, $2::jsonb, $3::jsonb)
       RETURNING id`,
      [pullRequestId, JSON.stringify(request), JSON.stringify(result)],
    );
    return Number(runInsert.rows[0].id);
  }

  private async updatePullRequestLatestState(
    client: DatabaseQueryClient,
    pullRequestId: string,
    request: VerificationRequest,
    result: VerificationResult,
    runId: number,
    commentId?: number,
    checkRunId?: number,
  ): Promise<void> {
    await client.query(
      `UPDATE pull_requests
       SET
        title = $2,
        body = $3,
        author = $4,
        branch_name = $5,
        base_branch = $6,
        head_sha = $7,
        state = CASE WHEN $8 = 'reopened' THEN 'open' ELSE state END,
        risk_score = $9,
        verdict = $10,
        latest_comment_id = COALESCE($11, latest_comment_id),
        latest_check_run_id = COALESCE($12, latest_check_run_id),
        latest_verification_run_id = $13,
        updated_at = NOW()
      WHERE id = $1`,
      [
        pullRequestId,
        request.title,
        request.body,
        request.author,
        request.branchName,
        request.baseBranch,
        request.headSha,
        request.action,
        result.riskScore,
        result.verdict,
        commentId ?? null,
        checkRunId ?? null,
        runId,
      ],
    );
  }

  private async persistChangedFiles(
    client: DatabaseQueryClient,
    runId: number,
    request: VerificationRequest,
  ): Promise<void> {
    for (const file of request.changedFiles) {
      await client.query(
        `INSERT INTO changed_files (verification_run_id, path, status, additions, deletions, patch)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          runId,
          file.path,
          file.status ?? null,
          file.additions ?? null,
          file.deletions ?? null,
          file.patch ?? null,
        ],
      );
    }
  }

  private async persistRiskFindings(
    client: DatabaseQueryClient,
    runId: number,
    result: VerificationResult,
  ): Promise<void> {
    for (const finding of result.riskFindings) {
      await client.query(
        `INSERT INTO risk_findings (verification_run_id, code, weight, reason)
         VALUES ($1, $2, $3, $4)`,
        [runId, finding.code, finding.weight, finding.reason],
      );
    }
  }

  private async persistVerificationRequirements(
    client: DatabaseQueryClient,
    runId: number,
    result: VerificationResult,
  ): Promise<void> {
    for (const requirement of result.verificationRequirements) {
      await client.query(
        `INSERT INTO verification_requirements (verification_run_id, code, message)
         VALUES ($1, $2, $3)`,
        [runId, requirement.code, requirement.message],
      );
    }
  }

  private async persistCheckRunSnapshots(
    client: DatabaseQueryClient,
    runId: number,
    request: VerificationRequest,
  ): Promise<void> {
    for (const checkRun of request.checkRuns) {
      await client.query(
        `INSERT INTO check_run_snapshots (verification_run_id, name, status, conclusion)
         VALUES ($1, $2, $3, $4)`,
        [runId, checkRun.name, checkRun.status, checkRun.conclusion],
      );
    }
  }

  private async persistExternalReviewFindings(
    client: DatabaseQueryClient,
    runId: number,
    result: VerificationResult,
  ): Promise<void> {
    for (const finding of result.externalReviewFindings) {
      await client.query(
        `INSERT INTO external_review_findings (verification_run_id, source, author, body)
         VALUES ($1, $2, $3, $4)`,
        [runId, finding.source, finding.author, finding.body],
      );
    }
  }

  private async upsertPolicy(
    client: DatabaseQueryClient,
    repoId: string,
    policyText: string | undefined,
  ): Promise<void> {
    if (!policyText) {
      return;
    }

    await client.query(
      `INSERT INTO repo_policies (repository_id, policy_yaml, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (repository_id) DO UPDATE SET
         policy_yaml = EXCLUDED.policy_yaml,
         updated_at = NOW()`,
      [repoId, policyText],
    );
  }

  private mapPullRequestRow(row: PullRequestRow): PullRequestRecord {
    return {
      id: row.id,
      repoId: row.repository_id,
      repoOwner: row.owner,
      repoName: row.name,
      number: row.pull_number,
      title: row.title,
      body: row.body,
      author: row.author,
      branchName: row.branch_name,
      baseBranch: row.base_branch,
      headSha: row.head_sha,
      state: row.state,
      installationId: this.toOptionalNumber(row.installation_id),
      pullRequestId: this.toOptionalNumber(row.github_pull_request_id),
      verdict: row.verdict,
      riskScore: row.risk_score,
      commentId: this.toOptionalNumber(row.latest_comment_id),
      checkRunId: this.toOptionalNumber(row.latest_check_run_id),
      latestVerificationRunId: this.toOptionalNumber(
        row.latest_verification_run_id,
      ),
      latestVerification:
        (row.result_json as VerificationResult | null) ?? undefined,
      lastRequest:
        (row.request_json as VerificationRequest | null) ?? undefined,
    };
  }

  private toOptionalNumber(value: number | string | null): number | undefined {
    if (value === null) {
      return undefined;
    }
    return Number(value);
  }
}

interface PullRequestRow {
  id: string;
  repository_id: string;
  owner: string;
  name: string;
  pull_number: number;
  title: string;
  body: string;
  author: string;
  branch_name: string;
  base_branch: string;
  head_sha: string;
  state: string;
  installation_id: number | string | null;
  github_pull_request_id: number | string | null;
  risk_score: number;
  verdict: VerificationResult["verdict"];
  latest_comment_id: number | string | null;
  latest_check_run_id: number | string | null;
  latest_verification_run_id: number | string | null;
  result_json: VerificationResult | null;
  request_json: VerificationRequest | null;
}
