import { Injectable } from '@nestjs/common';
import {
  PullRequestRecord,
  RepositoryRecord,
  VerificationRequest,
  VerificationResult,
} from '../domain/types';

@Injectable()
export class VerificationRepository {
  private readonly repositories = new Map<string, RepositoryRecord>();
  private readonly pullRequests = new Map<string, PullRequestRecord>();

  upsertFromRequest(request: VerificationRequest): PullRequestRecord {
    const repoId = request.repoId || `${request.repoOwner}/${request.repoName}`;
    if (!this.repositories.has(repoId)) {
      this.repositories.set(repoId, {
        id: repoId,
        owner: request.repoOwner,
        name: request.repoName,
      });
    }

    const pullRequestId = `${repoId}#${request.pullNumber}`;
    const existing = this.pullRequests.get(pullRequestId);
    const record: PullRequestRecord = {
      id: pullRequestId,
      repoId,
      number: request.pullNumber,
      title: request.title,
      author: request.author,
      branchName: request.branchName,
      state: 'open',
      verdict: existing?.verdict ?? 'neutral',
      riskScore: existing?.riskScore ?? 0,
      latestVerification: existing?.latestVerification,
      lastRequest: request,
      commentId: existing?.commentId,
    };
    this.pullRequests.set(pullRequestId, record);
    return record;
  }

  saveVerificationResult(
    pullRequestId: string,
    result: VerificationResult,
    request: VerificationRequest,
    commentId?: number,
  ): PullRequestRecord {
    const existing = this.pullRequests.get(pullRequestId);
    if (!existing) {
      throw new Error(`Unknown pull request ${pullRequestId}`);
    }
    const updated: PullRequestRecord = {
      ...existing,
      latestVerification: result,
      lastRequest: request,
      riskScore: result.riskScore,
      verdict: result.verdict,
      commentId: commentId ?? existing.commentId,
    };
    this.pullRequests.set(pullRequestId, updated);
    return updated;
  }

  listRepositories(): RepositoryRecord[] {
    return [...this.repositories.values()];
  }

  listPullRequests(repoId: string): PullRequestRecord[] {
    return [...this.pullRequests.values()].filter((pullRequest) => pullRequest.repoId === repoId);
  }

  getPullRequest(pullRequestId: string): PullRequestRecord | undefined {
    return this.pullRequests.get(pullRequestId);
  }
}
