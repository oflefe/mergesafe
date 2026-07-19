import {
  VerificationRequest,
} from "../../../../src/domain/types";
import { OllamaEmbeddingClient } from "../../../../src/verification/pr-classification/embedding-client";
import { PullRequestTypePrototypeIndex } from "../../../../src/verification/pr-classification/prototype-index";
import {
  classifyPullRequestTypeDeterministically,
  cosineSimilarity,
  PullRequestTypeClassifier,
} from "../../../../src/verification/pr-classification/pr-type-classifier";

function request(
  overrides: Partial<VerificationRequest> = {},
): VerificationRequest {
  return {
    repoOwner: "acme",
    repoName: "api",
    repoId: "acme/api",
    pullNumber: 1,
    title: "Add patient eligibility workflow",
    body: "Introduces a new eligibility capability.",
    branchName: "feature/patient-eligibility",
    baseBranch: "main",
    headSha: "abc",
    author: "dev",
    action: "opened",
    commits: [{ message: "add eligibility workflow" }],
    changedFiles: [{ path: "src/eligibility.ts", additions: 20 }],
    checkRuns: [],
    reviewComments: [],
    ...overrides,
  };
}

function classifier(options: {
  enabled: boolean;
  documentEmbedding?: number[];
  prototypeEmbeddings?: number[][];
  fail?: boolean;
}): PullRequestTypeClassifier {
  let calls = 0;
  const client = {
    getMetadata: () => ({ provider: "ollama" as const, model: "all-minilm" }),
    isEnabled: () => options.enabled,
    embed: jest.fn(async (inputs: string[]) => {
      if (options.fail) {
        throw new Error("offline");
      }
      calls += 1;
      if (calls === 1 && inputs.length === 1) {
        return [options.documentEmbedding ?? [1, 0]];
      }
      return (
        options.prototypeEmbeddings ?? [
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ]
      );
    }),
  } as unknown as OllamaEmbeddingClient;
  const index = new PullRequestTypePrototypeIndex(client);
  return new PullRequestTypeClassifier(client, index);
}

describe("PullRequestTypeClassifier", () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      PR_CLASSIFIER_MIN_SIMILARITY: "0.6",
      PR_CLASSIFIER_MAX_LABELS: "2",
    };
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  it("classifies clear structural PR types deterministically", () => {
    expect(
      classifyPullRequestTypeDeterministically(
        request({
          changedFiles: [
            { path: "migrations/20260719_add_patient.sql" },
            { path: "src/auth/session.ts" },
          ],
        }),
      ).map((item) => item.type),
    ).toEqual(["database-migration", "security"]);
  });

  it("uses embeddings for ambiguous intent and keeps the result advisory", async () => {
    const result = await classifier({
      enabled: true,
      documentEmbedding: [1, 0],
    }).classify(request());

    expect(result.status).toBe("classified");
    expect(result.advisoryOnly).toBe(true);
    expect(result.classifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "feature",
          source: "embedding",
          score: 1,
        }),
      ]),
    );
  });

  it("abstains when semantic similarities are below threshold", async () => {
    const result = await classifier({
      enabled: true,
      documentEmbedding: [1, 1],
      prototypeEmbeddings: [
        [1, -1],
        [-1, 1],
        [-1, -1],
        [0.1, -0.1],
      ],
    }).classify(request());

    expect(result).toMatchObject({ status: "abstained", classifications: [] });
  });

  it("continues with deterministic evidence when the model is unavailable", async () => {
    const result = await classifier({ enabled: true, fail: true }).classify(
      request({ changedFiles: [{ path: "README.md" }] }),
    );

    expect(result).toMatchObject({
      status: "unavailable",
      classifications: [
        expect.objectContaining({
          type: "documentation",
          source: "deterministic",
        }),
      ],
    });
  });

  it("calculates cosine similarity and validates vector dimensions", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(
      "different dimensions",
    );
  });
});
