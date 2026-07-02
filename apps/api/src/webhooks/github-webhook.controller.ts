import { Body, Controller, Headers, HttpCode, Inject, Post, RawBody } from '@nestjs/common';
import { VERIFICATION_QUEUE, VerificationQueue } from '../queue/verification-queue';
import { VerificationRequest } from '../domain/types';
import { verifyWebhookSignature } from './webhook-signature';
import { GitHubEvidenceFetcher } from '../github/github-evidence-fetcher';

const ACCEPTED_PULL_REQUEST_ACTIONS = ['opened', 'synchronize', 'reopened'] as const;
type AcceptedPullRequestAction = (typeof ACCEPTED_PULL_REQUEST_ACTIONS)[number];

interface PullRequestWebhookPayload {
  action: string;
  installation?: { id: number };
  pull_request: {
    number: number;
    id: number;
    title: string;
    body: string | null;
    user: { login: string };
    head: { ref: string; sha: string };
    base: { ref: string };
  };
  repository: {
    owner: { login: string };
    name: string;
    full_name: string;
  };
}

function isAcceptedPullRequestAction(action: string): action is AcceptedPullRequestAction {
  return (ACCEPTED_PULL_REQUEST_ACTIONS as readonly string[]).includes(action);
}

@Controller('webhooks')
export class GitHubWebhookController {
  constructor(
    @Inject(VERIFICATION_QUEUE) private readonly queue: VerificationQueue,
    private readonly evidenceFetcher: GitHubEvidenceFetcher,
  ) {}

  @Post('github')
  @HttpCode(202)
  async handle(
    @RawBody() rawBody: Buffer,
    @Body() payload: PullRequestWebhookPayload,
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    verifyWebhookSignature(rawBody, signature, process.env.GITHUB_WEBHOOK_SECRET);

    if (event !== 'pull_request' || !isAcceptedPullRequestAction(payload.action)) {
      return { accepted: false };
    }

    const { pull_request: pr, repository, installation } = payload;

    const evidence = await this.evidenceFetcher.fetchPullRequestEvidence(
      repository.owner.login,
      repository.name,
      pr.number,
      pr.head.sha,
      installation?.id,
    );

    const request: VerificationRequest = {
      repoOwner: repository.owner.login,
      repoName: repository.name,
      repoId: repository.full_name,
      pullNumber: pr.number,
      pullRequestId: pr.id,
      title: pr.title,
      body: pr.body ?? '',
      branchName: pr.head.ref,
      baseBranch: pr.base.ref,
      headSha: pr.head.sha,
      author: pr.user.login,
      action: payload.action as AcceptedPullRequestAction,
      installationId: installation?.id,
      commits: evidence.commits,
      changedFiles: evidence.changedFiles,
      checkRuns: evidence.checkRuns,
      reviewComments: evidence.reviewComments,
      repositoryFiles: evidence.repositoryFiles,
      repositoryScripts: evidence.repositoryScripts,
      policyText: evidence.policyText,
    };

    await this.queue.enqueue(request);
    return { accepted: true, pullRequest: `${request.repoId}#${request.pullNumber}` };
  }
}
