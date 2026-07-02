export type CheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | null;

export interface CommitInfo {
  sha?: string;
  message: string;
}

export interface ChangedFile {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
  content?: string;
}

export interface CheckRunSnapshot {
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: CheckConclusion;
}

export interface ReviewComment {
  id: number;
  author: string;
  body: string;
  resolved?: boolean;
}

export interface VerificationRequest {
  repoOwner: string;
  repoName: string;
  repoId: string;
  pullNumber: number;
  title: string;
  body: string;
  branchName: string;
  baseBranch: string;
  headSha: string;
  author: string;
  action: "opened" | "synchronize" | "reopened" | "recheck";
  installationId?: number;
  pullRequestId?: number;
  commits: CommitInfo[];
  changedFiles: ChangedFile[];
  checkRuns: CheckRunSnapshot[];
  reviewComments: ReviewComment[];
  repositoryFiles?: Record<string, string>;
  repositoryScripts?: Record<string, string>;
  policyText?: string;
  evidenceFindings?: string[];
}

export interface RiskFinding {
  code: string;
  weight: number;
  reason: string;
}

export interface ExternalReviewFinding {
  source: string;
  author: string;
  body: string;
}

export interface TestImpactResult {
  impactedTests: string[];
  missingTestCoverage: string[];
  suggestedCommands: string[];
}

export interface PolicyFailure {
  code: string;
  verdict: "pass" | "needs_review" | "fail";
  message: string;
}

export interface VerificationRequirement {
  code: string;
  message: string;
}

export interface VerificationPolicyRule {
  id: string;
  when: {
    paths: string[];
  };
  require?: {
    changedPaths?: string[];
    tests?: string[];
    review?: "human";
  };
  verdict: "pass" | "needs_review" | "fail";
  message: string;
}

export interface VerificationPolicy {
  version: 1;
  rules: VerificationPolicyRule[];
  heuristics: {
    branchIndicators: string[];
  };
  riskWeights: Record<string, number>;
}

export interface VerificationResult {
  pullRequestId: string;
  repoId: string;
  riskScore: number;
  riskFindings: RiskFinding[];
  testImpact: TestImpactResult;
  policyFailures: PolicyFailure[];
  verificationRequirements: VerificationRequirement[];
  externalReviewFindings: ExternalReviewFinding[];
  ciPassed: boolean;
  ciSummary: string;
  likelyAgentAuthored: boolean;
  commentBody: string;
  verdict: "pass" | "neutral" | "fail";
  checkConclusion: "success" | "neutral" | "failure";
}

export interface RepositoryRecord {
  id: string;
  owner: string;
  name: string;
}

export interface PullRequestRecord {
  id: string;
  repoId: string;
  repoOwner: string;
  repoName: string;
  number: number;
  title: string;
  body: string;
  author: string;
  branchName: string;
  baseBranch: string;
  headSha: string;
  state: string;
  installationId?: number;
  pullRequestId?: number;
  verdict: VerificationResult["verdict"];
  riskScore: number;
  checkRunId?: number;
  latestVerificationRunId?: number;
  latestVerification?: VerificationResult;
  lastRequest?: VerificationRequest;
  commentId?: number;
}
