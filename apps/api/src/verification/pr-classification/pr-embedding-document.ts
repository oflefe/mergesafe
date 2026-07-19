import { createHash } from "node:crypto";
import { VerificationRequest } from "../../domain/types";
import { analyzePullRequestScope } from "../scope-analysis";

export const PR_EMBEDDING_INPUT_VERSION = "pr-input-v1";

const MAX_BODY_LENGTH = 500;
const MAX_COMMIT_COUNT = 8;
const MAX_COMMIT_LENGTH = 120;
const MAX_FILE_COUNT = 30;
const MAX_DOCUMENT_LENGTH = 3_000;

export interface PullRequestEmbeddingDocument {
  text: string;
  hash: string;
  inputVersion: string;
  omittedCommits: number;
  omittedFiles: number;
}

function normalizeText(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function buildPullRequestEmbeddingDocument(
  request: VerificationRequest,
): PullRequestEmbeddingDocument {
  const commits = request.commits
    .map((commit) => normalizeText(commit.message, MAX_COMMIT_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_COMMIT_COUNT);
  const changedFiles = [...request.changedFiles]
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, MAX_FILE_COUNT)
    .map((file) => {
      const additions = file.additions ?? 0;
      const deletions = file.deletions ?? 0;
      const status = file.status ? `, status ${file.status}` : "";
      return `${file.path}${status}, +${additions}/-${deletions}`;
    });
  const scope = analyzePullRequestScope(request.changedFiles);
  const body = normalizeText(request.body, MAX_BODY_LENGTH);

  const unboundedText = [
    `Title: ${normalizeText(request.title, 300) || "(none)"}`,
    `Body: ${body || "(none)"}`,
    `Branch: ${normalizeText(request.branchName, 200) || "(none)"}`,
    `Base branch: ${normalizeText(request.baseBranch, 200) || "(none)"}`,
    `Scope: ${scope.totalFiles} files, ${scope.sourceFiles} source, ${scope.testFiles} test, ${scope.configurationFiles} configuration, ${scope.documentationFiles} documentation, ${scope.totalLineDelta} changed lines.`,
    `Commits:\n${commits.length > 0 ? commits.map((message) => `- ${message}`).join("\n") : "- (none)"}`,
    `Changed files:\n${changedFiles.length > 0 ? changedFiles.map((path) => `- ${path}`).join("\n") : "- (none)"}`,
  ].join("\n\n");
  const text = unboundedText.slice(0, MAX_DOCUMENT_LENGTH);

  return {
    text,
    hash: createHash("sha256").update(text).digest("hex"),
    inputVersion: PR_EMBEDDING_INPUT_VERSION,
    omittedCommits: Math.max(0, request.commits.length - commits.length),
    omittedFiles: Math.max(0, request.changedFiles.length - changedFiles.length),
  };
}
