import { Module } from "@nestjs/common";
import { GitHubAppClient } from "./github/github.client";
import { GitHubEvidenceFetcher } from "./github/github-evidence-fetcher";
import { PullRequestsController } from "./http/pull-requests.controller";
import { RepositoriesController } from "./http/repositories.controller";
import {
  VERIFICATION_QUEUE,
  verificationQueueProvider,
} from "./queue/verification-queue";
import { createDatabaseClient, DATABASE_CLIENT } from "./storage/database.pool";
import { DatabaseShutdownService } from "./storage/database-shutdown.service";
import { VerificationRepository } from "./storage/verification.repository";
import { OllamaEmbeddingClient } from "./verification/pr-classification/embedding-client";
import { PullRequestTypeClassifier } from "./verification/pr-classification/pr-type-classifier";
import { PullRequestTypePrototypeIndex } from "./verification/pr-classification/prototype-index";
import { PolicyLoader } from "./verification/policy-loader";
import { VerificationOrchestrator } from "./verification/verification.orchestrator";
import { VerificationService } from "./verification/verification.service";
import { GitHubWebhookController } from "./webhooks/github-webhook.controller";

@Module({
  controllers: [
    GitHubWebhookController,
    RepositoriesController,
    PullRequestsController,
  ],
  providers: [
    GitHubAppClient,
    GitHubEvidenceFetcher,
    {
      provide: DATABASE_CLIENT,
      useFactory: createDatabaseClient,
    },
    DatabaseShutdownService,
    VerificationRepository,
    PolicyLoader,
    VerificationService,
    OllamaEmbeddingClient,
    PullRequestTypePrototypeIndex,
    PullRequestTypeClassifier,
    VerificationOrchestrator,
    {
      provide: VERIFICATION_QUEUE,
      inject: [VerificationOrchestrator],
      useFactory: verificationQueueProvider,
    },
  ],
})
export class AppModule {}
