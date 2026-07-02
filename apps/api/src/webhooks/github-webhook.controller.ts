import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException, Inject } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { VERIFICATION_QUEUE, VerificationQueue } from '../queue/verification-queue';
import { VerificationRequest } from '../domain/types';

interface GitHubWebhookPayload {
  action: 'opened' | 'synchronize' | string;
  installation?: { id: number };
  repository: { owner: { login: string }; name: string; full_name: string };
  pull_request: {
    number: number;
    id: number;
    title: string;
    body?: string | null;
    head: { ref: string };
    user: { login: string };
    commits?: number;
  };
  commits?: Array<{ sha?: string; message: string }>;
  changed_files?: Array<{
    filename: string;
    status?: string;
    additions?: number;
    deletions?: number;
    patch?: string;
    content?: string;
  }>;
  check_runs?: Array<{ name: string; status: 'queued' | 'in_progress' | 'completed'; conclusion: any }>;
  review_comments?: Array<{ id: number; user: { login: string }; body: string; resolved?: boolean }>;
  repository_files?: Record<string, string>;
  repository_scripts?: Record<string, string>;
  policy_text?: string;
}

@Controller('webhooks')
export class GitHubWebhookController {
  constructor(@Inject(VERIFICATION_QUEUE) private readonly queue: VerificationQueue) {}

  @Post('github')
  @HttpCode(202)
  async handle(
    @Body() payload: GitHubWebhookPayload,
    @Headers('x-github-event') event: string,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    this.verifySignature(signature, payload);
    if (event !== 'pull_request' || !['opened', 'synchronize'].includes(payload.action)) {
      return { accepted: false };
    }

    const request: VerificationRequest = {
      repoOwner: payload.repository.owner.login,
      repoName: payload.repository.name,
      repoId: payload.repository.full_name,
      pullNumber: payload.pull_request.number,
      pullRequestId: payload.pull_request.id,
      title: payload.pull_request.title,
      body: payload.pull_request.body ?? '',
      branchName: payload.pull_request.head.ref,
      author: payload.pull_request.user.login,
      action: payload.action as 'opened' | 'synchronize',
      installationId: payload.installation?.id,
      commits: payload.commits ?? [],
      changedFiles:
        payload.changed_files?.map((file) => ({
          path: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
          content: file.content,
        })) ?? [],
      checkRuns: payload.check_runs ?? [],
      reviewComments:
        payload.review_comments?.map((comment) => ({
          id: comment.id,
          author: comment.user.login,
          body: comment.body,
          resolved: comment.resolved,
        })) ?? [],
      repositoryFiles: payload.repository_files,
      repositoryScripts: payload.repository_scripts,
      policyText: payload.policy_text,
    };

    await this.queue.enqueue(request);
    return { accepted: true, pullRequest: `${request.repoId}#${request.pullNumber}` };
  }

  private verifySignature(signature: string | undefined, payload: GitHubWebhookPayload) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret || !signature) {
      return;
    }
    const digest = `sha256=${createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex')}`;
    const left = Buffer.from(signature);
    const right = Buffer.from(digest);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
