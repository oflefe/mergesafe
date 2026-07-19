import { Injectable, Logger } from "@nestjs/common";
import {
  PullRequestType,
  PullRequestTypeClassification,
  PullRequestTypeClassificationItem,
  VerificationRequest,
} from "../../domain/types";
import { classifyChangedFiles } from "../file-classification";
import { OllamaEmbeddingClient } from "./embedding-client";
import { buildPullRequestEmbeddingDocument } from "./pr-embedding-document";
import { PullRequestTypePrototypeIndex } from "./prototype-index";

const dependencyPattern =
  /(^|\/)(package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|requirements\.txt|poetry\.lock|pipfile\.lock|cargo\.(toml|lock)|go\.(mod|sum)|pyproject\.toml|pom\.xml|build\.gradle)$/i;
const migrationPattern =
  /(^|\/)(migrations?|prisma\/migrations)(\/|$)|(^|\/)schema\.sql$/i;
const infrastructurePattern =
  /(^|\/)(\.github\/workflows|terraform|infra|helm|k8s|kubernetes|ansible)(\/|$)|(^|\/)(dockerfile(?:\.[^/]*)?|docker-compose(?:\.[^/]*)?|compose(?:\.[^/]*)?|[^/]+\.tf|[^/]+\.tfvars)$/i;
const securityPattern =
  /(auth|session|permission|rbac|acl|tenant|secret|credential|token|encryption)/i;
const generatedPattern = /(generated|auto-generated|do not edit)/i;

function parseSimilarity(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= -1 && parsed <= 1
    ? parsed
    : fallback;
}

function parseMaxLabels(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error("Cannot compare embeddings with different dimensions.");
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! ** 2;
    rightMagnitude += right[index]! ** 2;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function classification(
  type: PullRequestType,
  source: PullRequestTypeClassificationItem["source"],
  score: number,
  evidence: string[],
): PullRequestTypeClassificationItem {
  return { type, source, score, evidence };
}

export function classifyPullRequestTypeDeterministically(
  request: VerificationRequest,
): PullRequestTypeClassificationItem[] {
  const classifiedFiles = classifyChangedFiles(request.changedFiles);
  const paths = classifiedFiles.map((file) => file.path);
  const nonDocumentationFiles = classifiedFiles.filter(
    (file) => file.kind !== "documentation",
  );
  const results = new Map<PullRequestType, PullRequestTypeClassificationItem>();
  const add = (type: PullRequestType, evidence: string[]) =>
    results.set(type, classification(type, "deterministic", 1, evidence));

  if (
    classifiedFiles.length > 0 &&
    classifiedFiles.every((file) => file.kind === "documentation")
  ) {
    add("documentation", paths);
  }
  if (
    nonDocumentationFiles.length > 0 &&
    nonDocumentationFiles.every((file) => file.kind === "test")
  ) {
    add(
      "test-only",
      nonDocumentationFiles.map((file) => file.path),
    );
  }
  const migrationPaths = paths.filter((path) => migrationPattern.test(path));
  if (migrationPaths.length > 0) {
    add("database-migration", migrationPaths);
  }
  if (
    nonDocumentationFiles.length > 0 &&
    nonDocumentationFiles.every((file) => dependencyPattern.test(file.path))
  ) {
    add(
      "dependency-update",
      nonDocumentationFiles.map((file) => file.path),
    );
  }
  const infrastructurePaths = paths.filter((path) =>
    infrastructurePattern.test(path),
  );
  if (infrastructurePaths.length > 0) {
    add("infrastructure", infrastructurePaths);
  }
  const configurationPaths = classifiedFiles
    .filter((file) => file.kind === "configuration")
    .map((file) => file.path)
    .filter((path) => !dependencyPattern.test(path) && !infrastructurePattern.test(path));
  if (configurationPaths.length > 0) {
    add("configuration", configurationPaths);
  }
  const securityPaths = paths.filter((path) => securityPattern.test(path));
  if (securityPaths.length > 0) {
    add("security", securityPaths);
  }
  const generatedPaths = request.changedFiles
    .filter(
      (file) =>
        generatedPattern.test(file.patch ?? "") ||
        generatedPattern.test(file.content ?? ""),
    )
    .map((file) => file.path);
  if (generatedPaths.length > 0) {
    add("generated-code", generatedPaths);
  }

  return [...results.values()].sort((left, right) =>
    left.type.localeCompare(right.type),
  );
}

@Injectable()
export class PullRequestTypeClassifier {
  private readonly logger = new Logger(PullRequestTypeClassifier.name);

  constructor(
    private readonly embeddingClient: OllamaEmbeddingClient,
    private readonly prototypeIndex: PullRequestTypePrototypeIndex,
  ) {}

  async classify(
    request: VerificationRequest,
  ): Promise<PullRequestTypeClassification> {
    const deterministic = classifyPullRequestTypeDeterministically(request);
    const document = buildPullRequestEmbeddingDocument(request);
    const metadata = this.embeddingClient.getMetadata();
    const base = {
      advisoryOnly: true as const,
      classifications: deterministic,
      provider: metadata.provider,
      model: metadata.model,
      prototypeVersion: this.prototypeIndex.getVersion(),
      inputVersion: document.inputVersion,
      documentHash: document.hash,
    };

    if (!this.embeddingClient.isEnabled()) {
      return {
        ...base,
        status: "disabled",
        message: "Semantic PR classification is disabled.",
      };
    }

    try {
      const [documentEmbedding] = await this.embeddingClient.embed([document.text]);
      const prototypes = await this.prototypeIndex.ingest();
      const existingTypes = new Set(deterministic.map((item) => item.type));
      const minimumSimilarity = parseSimilarity(
        process.env.PR_CLASSIFIER_MIN_SIMILARITY,
        0.62,
      );
      const maxLabels = parseMaxLabels(process.env.PR_CLASSIFIER_MAX_LABELS, 3);
      const semantic = prototypes
        .map((prototype) => ({
          type: prototype.type,
          similarity: cosineSimilarity(documentEmbedding!, prototype.embedding),
        }))
        .filter(
          (candidate) =>
            !existingTypes.has(candidate.type) &&
            candidate.similarity >= minimumSimilarity,
        )
        .sort(
          (left, right) =>
            right.similarity - left.similarity ||
            left.type.localeCompare(right.type),
        )
        .slice(0, maxLabels)
        .map((candidate) =>
          classification(
            candidate.type,
            "embedding",
            Number(candidate.similarity.toFixed(4)),
            [
              `Cosine similarity ${candidate.similarity.toFixed(4)} against the ${candidate.type} prototype.`,
            ],
          ),
        );
      const classifications = [...deterministic, ...semantic].sort(
        (left, right) =>
          right.score - left.score || left.type.localeCompare(right.type),
      );

      return {
        ...base,
        classifications,
        status: classifications.length > 0 ? "classified" : "abstained",
        message:
          semantic.length > 0
            ? "Semantic classifications are advisory and do not affect risk or verdict."
            : "The semantic classifier abstained below the configured similarity threshold.",
      };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      this.logger.warn(`PR classifier unavailable: ${errorName}`);
      return {
        ...base,
        status: "unavailable",
        message:
          "Semantic PR classification was unavailable; deterministic verification continued unchanged.",
      };
    }
  }
}
