import { Body, Controller, Get, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { VerificationRepository } from '../storage/verification.repository';
import { VERIFICATION_QUEUE, VerificationQueue } from '../queue/verification-queue';

@Controller()
export class PullRequestsController {
  constructor(
    private readonly repository: VerificationRepository,
    @Inject(VERIFICATION_QUEUE) private readonly queue: VerificationQueue,
  ) {}

  @Get('prs/:id/verification')
  getVerification(@Param('id') id: string) {
    const pullRequest = this.repository.getPullRequest(id);
    if (!pullRequest?.latestVerification) {
      throw new NotFoundException(`Verification for ${id} not found`);
    }
    return pullRequest.latestVerification;
  }

  @Post('prs/:id/recheck')
  async recheck(@Param('id') id: string, @Body() body: { repositoryFiles?: Record<string, string> } = {}) {
    const pullRequest = this.repository.getPullRequest(id);
    if (!pullRequest?.lastRequest) {
      throw new NotFoundException(`Pull request ${id} not found`);
    }
    const rerunRequest = {
      ...pullRequest.lastRequest,
      action: 'recheck' as const,
      repositoryFiles: body.repositoryFiles ?? pullRequest.lastRequest.repositoryFiles,
    };
    const result = await this.queue.enqueue(rerunRequest);
    return { rechecked: true, result };
  }
}
