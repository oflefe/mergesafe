import {
  PullRequestTypeClassification,
  VerificationRequest,
} from "../../domain/types";
import { PolicyLoader } from "../policy-loader";
import { VerificationService } from "../verification.service";

const request: VerificationRequest = {
  repoOwner: "acme",
  repoName: "api",
  repoId: "acme/api",
  pullNumber: 5,
  title: "Update documentation",
  body: "Clarifies local setup.",
  branchName: "docs/setup",
  baseBranch: "main",
  headSha: "abc",
  author: "dev",
  action: "opened",
  commits: [{ message: "docs: clarify setup" }],
  changedFiles: [{ path: "README.md", additions: 4, deletions: 1 }],
  checkRuns: [
    { name: "verify", status: "completed", conclusion: "success" },
  ],
  reviewComments: [],
};

const classification: PullRequestTypeClassification = {
  status: "classified",
  advisoryOnly: true,
  classifications: [
    {
      type: "documentation",
      score: 1,
      source: "deterministic",
      evidence: ["README.md"],
    },
  ],
  provider: "ollama",
  model: "all-minilm",
  prototypeVersion: "pr-types-v1",
  inputVersion: "pr-input-v1",
  documentHash: "abc123",
  message: "Advisory only.",
};

describe("PR classification verification integration", () => {
  it("persists the advisory classification without changing score or verdict", () => {
    const service = new VerificationService(new PolicyLoader());
    const baseline = service.verify(request);
    const classified = service.verify(request, classification);

    expect(classified.decisionTrace?.prClassification).toEqual(classification);
    expect(classified.riskScore).toBe(baseline.riskScore);
    expect(classified.riskFindings).toEqual(baseline.riskFindings);
    expect(classified.verdict).toBe(baseline.verdict);
    expect(classified.checkConclusion).toBe(baseline.checkConclusion);
  });
});
