import { VerificationRequest, Verdict } from "../domain/types";
import { GitHubAppClient } from "../github/github.client";
import { VerificationRepository } from "../storage/verification.repository";
import { PullRequestTypeClassifier } from "./pr-classification/pr-type-classifier";
import { VerificationOrchestrator } from "./verification.orchestrator";
import { VerificationService } from "./verification.service";

const request = {
  repoOwner: "acme",
  repoName: "api",
  repoId: "acme/api",
  pullNumber: 1,
  title: "Add feature",
  body: "",
  branchName: "feature/example",
  baseBranch: "main",
  headSha: "abc",
  author: "dev",
  action: "opened",
  commits: [],
  changedFiles: [],
  checkRuns: [],
  reviewComments: [],
} satisfies VerificationRequest;

describe("VerificationOrchestrator", () => {
  it("classifies the PR before verification and persists the resulting output", async () => {
    const classification = {
      status: "disabled" as const,
      advisoryOnly: true as const,
      classifications: [],
      provider: "ollama" as const,
      model: "all-minilm",
      prototypeVersion: "pr-types-v1",
      inputVersion: "pr-input-v1",
      documentHash: "hash",
      message: "disabled",
    };
    const result = {
      pullRequestId: "acme/api#1",
      repoId: "acme/api",
      riskScore: 0,
      riskLevel: "LOW",
      riskFindings: [],
      riskDiagnostics: { uncategorizedFiles: [] },
      testImpact: {
        impactedTests: [],
        missingTestCoverage: [],
        suggestedCommands: [],
        testMappings: [],
      },
      policyFailures: [],
      verificationRequirements: [],
      externalReviewFindings: [],
      ciPassed: false,
      ciSummary: "none",
      likelyAgentAuthored: false,
      commentBody: "report",
      verdict: Verdict.NEEDS_REVIEW,
      checkConclusion: "neutral" as const,
    };
    const verificationService = {
      verify: jest.fn(() => result),
    } as unknown as VerificationService;
    const repository = {
      upsertFromRequest: jest.fn(async () => ({ id: "pr-1" })),
      saveVerificationResult: jest.fn(async () => undefined),
    } as unknown as VerificationRepository;
    const githubClient = {
      upsertVerificationComment: jest.fn(async () => 1),
      createOrUpdateCheckRun: jest.fn(async () => 2),
    } as unknown as GitHubAppClient;
    const classifier = {
      classify: jest.fn(async () => classification),
    } as unknown as PullRequestTypeClassifier;
    const orchestrator = new VerificationOrchestrator(
      verificationService,
      repository,
      githubClient,
      classifier,
    );

    await expect(orchestrator.run(request)).resolves.toBe(result);
    expect(classifier.classify).toHaveBeenCalledWith(request);
    expect(verificationService.verify).toHaveBeenCalledWith(
      request,
      classification,
    );
    expect(repository.saveVerificationResult).toHaveBeenCalled();
  });
});
