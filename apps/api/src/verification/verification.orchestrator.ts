import { Injectable } from "@nestjs/common";
import { VerificationRequest, VerificationResult } from "../domain/types";
import { GitHubAppClient } from "../github/github.client";
import { VerificationRepository } from "../storage/verification.repository";
import { PullRequestTypeClassifier } from "./pr-classification/pr-type-classifier";
import { VerificationService } from "./verification.service";

@Injectable()
export class VerificationOrchestrator {
  constructor(
    private readonly verificationService: VerificationService,
    private readonly repository: VerificationRepository,
    private readonly githubClient: GitHubAppClient,
    private readonly prTypeClassifier: PullRequestTypeClassifier,
  ) {}

  async run(request: VerificationRequest): Promise<VerificationResult> {
    const pullRequestRecord = await this.repository.upsertFromRequest(request);
    const prClassification = await this.prTypeClassifier.classify(request);
    const result = this.verificationService.verify(request, prClassification);
    const commentId = await this.githubClient.upsertVerificationComment(
      request,
      result.commentBody,
      pullRequestRecord.commentId,
    );
    const existingCheckRunId =
      pullRequestRecord.lastRequest?.headSha === request.headSha
        ? pullRequestRecord.checkRunId
        : undefined;
    const checkRunId = await this.githubClient.createOrUpdateCheckRun(
      request,
      result,
      existingCheckRunId,
    );
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
