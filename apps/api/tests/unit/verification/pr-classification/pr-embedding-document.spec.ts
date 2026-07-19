import { VerificationRequest } from "../../domain/types";
import { buildPullRequestEmbeddingDocument } from "./pr-embedding-document";

const request: VerificationRequest = {
  repoOwner: "acme",
  repoName: "api",
  repoId: "acme/api",
  pullNumber: 12,
  title: "Fix duplicate invoice creation",
  body: "Corrects a retry edge case.",
  branchName: "fix/invoice-retry",
  baseBranch: "main",
  headSha: "abc123",
  author: "dev",
  action: "opened",
  commits: [{ message: "fix billing retry" }],
  changedFiles: [
    {
      path: "src/billing/retry.ts",
      additions: 8,
      deletions: 2,
      patch: "+const productionSecret = 'do-not-ingest';",
    },
  ],
  checkRuns: [],
  reviewComments: [],
};

describe("buildPullRequestEmbeddingDocument", () => {
  it("builds deterministic bounded metadata without embedding raw patches", () => {
    const first = buildPullRequestEmbeddingDocument(request);
    const second = buildPullRequestEmbeddingDocument(request);

    expect(first).toEqual(second);
    expect(first.text).toContain("Fix duplicate invoice creation");
    expect(first.text).toContain("src/billing/retry.ts");
    expect(first.text).not.toContain("productionSecret");
    expect(first.hash).toHaveLength(64);
    expect(first.text.length).toBeLessThanOrEqual(3000);
  });

  it("reports omitted files and commits when limits are exceeded", () => {
    const result = buildPullRequestEmbeddingDocument({
      ...request,
      commits: Array.from({ length: 25 }, (_, index) => ({
        message: `commit ${index}`,
      })),
      changedFiles: Array.from({ length: 105 }, (_, index) => ({
        path: `src/file-${index}.ts`,
      })),
    });

    expect(result.omittedCommits).toBe(17);
    expect(result.omittedFiles).toBe(75);
  });
});
