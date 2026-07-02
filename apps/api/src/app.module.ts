import { Module } from '@nestjs/common';
import { GitHubAppClient } from './github/github.client';
import { PullRequestsController } from './http/pull-requests.controller';
import { RepositoriesController } from './http/repositories.controller';
import {
  VERIFICATION_QUEUE,
  verificationQueueProvider,
} from './queue/verification-queue';
import { VerificationRepository } from './storage/verification.repository';
import { VerificationOrchestrator } from './verification/verification.orchestrator';
import { PolicyLoader } from './verification/policy-loader';
import { VerificationService } from './verification/verification.service';
import { GitHubWebhookController } from './webhooks/github-webhook.controller';

@Module({
  controllers: [GitHubWebhookController, RepositoriesController, PullRequestsController],
  providers: [
    GitHubAppClient,
    VerificationRepository,
    PolicyLoader,
    VerificationService,
    VerificationOrchestrator,
    {
      provide: VERIFICATION_QUEUE,
      inject: [VerificationOrchestrator],
      useFactory: verificationQueueProvider,
    },
  ],
})
export class AppModule {}
