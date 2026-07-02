import { Body, Controller, Get, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { GitHubEvidenceFetcher } from '../github/github-evidence-fetcher';
import { VerificationRepository } from '../storage/verification.repository';
import { VERIFICATION_QUEUE, VerificationQueue } from '../queue/verification-queue';

@Controller()
export class PullRequestsController {
  constructor(
    private readonly repository: VerificationRepository,
    private readonly evidenceFetcher: GitHubEvidenceFetcher,
    @Inject(VERIFICATION_QUEUE) private readonly queue: VerificationQueue,
  ) {}

  @Get('prs/:id/verification')
  async getVerification(@Param('id') id: string) {
    const pullRequest = await this.repository.getPullRequest(id);
    if (!pullRequest?.latestVerification) {
      throw new NotFoundException(`Verification for ${id} not found`);
    }
    return pullRequest.latestVerification;
  }

  @Post('prs/:id/recheck')
  async recheck(@Param('id') id: string, @Body() _body: { repositoryFiles?: Record<string, string> } = {}) {
    const pullRequest = await this.repository.getPullRequest(id);
    if (!pullRequest) {
      throw new NotFoundException(`Pull request ${id} not found`);
    }

    const evidence = await this.evidenceFetcher.fetchPullRequestEvidence(
      pullRequest.repoOwner,
      pullRequest.repoName,
      pullRequest.number,
      pullRequest.headSha,
      pullRequest.baseBranch,
      pullRequest.installationId,
    );

    const rerunRequest = {
      repoOwner: pullRequest.repoOwner,
      repoName: pullRequest.repoName,
      repoId: pullRequest.repoId,
      pullNumber: pullRequest.number,
      pullRequestId: pullRequest.pullRequestId,
      title: pullRequest.title,
      body: pullRequest.body,
      branchName: pullRequest.branchName,
      baseBranch: pullRequest.baseBranch,
      headSha: pullRequest.headSha,
      author: pullRequest.author,
      action: 'recheck' as const,
      installationId: pullRequest.installationId,
      commits: evidence.commits,
      changedFiles: evidence.changedFiles,
      checkRuns: evidence.checkRuns,
      reviewComments: evidence.reviewComments,
      repositoryFiles: evidence.repositoryFiles,
      repositoryScripts: evidence.repositoryScripts,
      policyText: evidence.policyText,
      evidenceFindings: evidence.fetchFindings,
    };

    const result = await this.queue.enqueue(rerunRequest);
    return { rechecked: true, result };
  }
}
