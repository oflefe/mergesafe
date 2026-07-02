import { Injectable } from '@nestjs/common';
import { GitHubAppClient } from '../github/github.client';
import { VerificationRequest, VerificationResult } from '../domain/types';
import { VerificationRepository } from '../storage/verification.repository';
import { VerificationService } from './verification.service';

@Injectable()
export class VerificationOrchestrator {
  constructor(
    private readonly verificationService: VerificationService,
    private readonly repository: VerificationRepository,
    private readonly githubClient: GitHubAppClient,
  ) {}

  async run(request: VerificationRequest): Promise<VerificationResult> {
    const pullRequestRecord = await this.repository.upsertFromRequest(request);
    const result = this.verificationService.verify(request);
    const commentId = await this.githubClient.upsertVerificationComment(
      request,
      result.commentBody,
      pullRequestRecord.commentId,
    );
    const checkRunId = await this.githubClient.createOrUpdateCheckRun(request, result);
    await this.repository.saveVerificationResult(
      pullRequestRecord.id,
      result,
      request,
      commentId,
      checkRunId,
    );
    return result;
  }
}
