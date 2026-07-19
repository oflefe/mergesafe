import { Injectable } from "@nestjs/common";
import { PullRequestType } from "../../domain/types";
import { OllamaEmbeddingClient } from "./embedding-client";
import {
  PR_TYPE_PROTOTYPE_VERSION,
  prototypeEmbeddingText,
  pullRequestTypePrototypes,
} from "./pr-type-prototypes";

export interface IndexedPullRequestTypePrototype {
  type: PullRequestType;
  embedding: number[];
}

@Injectable()
export class PullRequestTypePrototypeIndex {
  private ingestion?: Promise<IndexedPullRequestTypePrototype[]>;

  constructor(private readonly embeddingClient: OllamaEmbeddingClient) {}

  ingest(): Promise<IndexedPullRequestTypePrototype[]> {
    if (!this.ingestion) {
      this.ingestion = this.buildIndex().catch((error) => {
        this.ingestion = undefined;
        throw error;
      });
    }
    return this.ingestion;
  }

  getVersion(): string {
    return PR_TYPE_PROTOTYPE_VERSION;
  }

  private async buildIndex(): Promise<IndexedPullRequestTypePrototype[]> {
    const semanticPrototypes = pullRequestTypePrototypes.filter(
      (prototype) => prototype.semantic,
    );
    const embeddings = await this.embeddingClient.embed(
      semanticPrototypes.map(prototypeEmbeddingText),
    );
    return semanticPrototypes.map((prototype, index) => ({
      type: prototype.type,
      embedding: embeddings[index]!,
    }));
  }
}
