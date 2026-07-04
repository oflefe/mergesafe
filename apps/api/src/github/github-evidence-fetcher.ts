import { Injectable, Logger } from "@nestjs/common";
import { createPrivateKey, createSign } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  ChangedFile,
  CheckRunSnapshot,
  CommitInfo,
  ReviewComment,
} from "../domain/types";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"];
const MAX_REPOSITORY_CONTEXT_FILES = 250;
const GITHUB_PAGE_SIZE = 100;

type ListFetchMode = "required" | "optional";

export class EvidenceFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceFetchError";
  }
}

export interface PullRequestEvidence {
  commits: CommitInfo[];
  changedFiles: ChangedFile[];
  checkRuns: CheckRunSnapshot[];
  reviewComments: ReviewComment[];
  repositoryFiles: Record<string, string>;
  repositoryScripts: Record<string, string> | undefined;
  policyText: string | undefined;
  fetchFindings: string[];
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Content(encoded: string): string {
  return Buffer.from(encoded.replace(/\n/g, ""), "base64").toString("utf-8");
}

function parsePackageScripts(
  content: string | undefined,
): Record<string, string> | undefined {
  if (!content) {
    return undefined;
  }
  try {
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> };
    return pkg.scripts ?? undefined;
  } catch {
    return undefined;
  }
}

function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

function isTestFile(path: string): boolean {
  return /(^|\/)(tests?|__tests__|specs?)\/|(\.|_)(spec|test)\.(ts|tsx|js|jsx|mjs|cjs|py)$/i.test(
    path,
  );
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function basenameWithoutExtension(path: string): string {
  const normalized = normalizePath(path);
  const name = normalized.split("/").pop() ?? normalized;
  return name.replace(/\.[^.]+$/, "");
}

function topLevelDirectory(path: string): string {
  return normalizePath(path).split("/")[0] ?? "";
}

function joinPath(baseDir: string, target: string): string {
  const segments = [
    ...baseDir.split("/").filter(Boolean),
    ...target.split("/"),
  ];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

function parseImports(path: string, content: string): string[] {
  const imports = new Set<string>();
  if (path.endsWith(".py")) {
    const fromRegex = /^\s*from\s+([.\w]+)\s+import\s+/gm;
    const importRegex = /^\s*import\s+([.\w]+)/gm;
    for (const regex of [fromRegex, importRegex]) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content))) {
        imports.add(match[1]);
      }
    }
    return [...imports];
  }

  const regex = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content))) {
    imports.add(match[1] ?? match[2]);
  }
  return [...imports];
}

function resolveImport(
  importer: string,
  importPath: string,
  repositoryFiles: Record<string, string>,
): string | undefined {
  if (importPath.startsWith(".")) {
    const base = joinPath(dirname(importer), importPath);
    const candidates = [
      base,
      ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
      ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
    ];
    return candidates.find((candidate) => candidate in repositoryFiles);
  }

  if (importer.endsWith(".py")) {
    const pyCandidate = `${importPath.replace(/\./g, "/")}.py`;
    if (pyCandidate in repositoryFiles) {
      return pyCandidate;
    }
    const initCandidate = `${importPath.replace(/\./g, "/")}/__init__.py`;
    if (initCandidate in repositoryFiles) {
      return initCandidate;
    }
  }

  return undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function emptyEvidence(): PullRequestEvidence {
  return {
    commits: [],
    changedFiles: [],
    checkRuns: [],
    reviewComments: [],
    repositoryFiles: {},
    repositoryScripts: undefined,
    policyText: undefined,
    fetchFindings: [],
  };
}

@Injectable()
export class GitHubEvidenceFetcher {
  private readonly logger = new Logger(GitHubEvidenceFetcher.name);

  async fetchPullRequestEvidence(
    owner: string,
    repoName: string,
    pullNumber: number,
    headSha: string,
    baseBranch: string,
    installationId: number | undefined,
  ): Promise<PullRequestEvidence> {
    try {
      const token = await this.resolveToken(
        installationId,
        owner,
        repoName,
        pullNumber,
      );
      const baseUrl = `https://api.github.com/repos/${owner}/${repoName}`;
      const findings: string[] = [];

      const [commits, changedFiles, ciEvidence, reviewComments, issueComments] =
        await Promise.all([
          this.fetchCommits(token, baseUrl, pullNumber),
          this.fetchChangedFiles(token, baseUrl, pullNumber),
          this.fetchCiEvidence(token, baseUrl, headSha),
          this.fetchPullRequestReviewComments(token, baseUrl, pullNumber),
          this.fetchIssueComments(token, baseUrl, pullNumber),
        ]);

      const defaultBranch = await this.fetchDefaultBranch(token, baseUrl);
      const policyRef = process.env.MERGESAFE_POLICY_REF || baseBranch;
      const [policyText, repositoryScripts, repositoryFiles] =
        await Promise.all([
          this.fetchPolicyText(token, baseUrl, policyRef),
          this.fetchRepositoryScripts(
            token,
            baseUrl,
            headSha,
            baseBranch,
            defaultBranch,
          ),
          this.fetchRepositoryContextFiles(
            token,
            baseUrl,
            changedFiles,
            headSha,
            findings,
          ),
        ]);

      return {
        commits,
        changedFiles,
        checkRuns: ciEvidence,
        reviewComments: [...reviewComments, ...issueComments],
        repositoryFiles,
        repositoryScripts,
        policyText,
        fetchFindings: findings,
      };
    } catch (error) {
      if (this.isLenientEvidenceMode()) {
        this.logger.warn(
          `Falling back to empty evidence for ${owner}/${repoName}#${pullNumber}`,
        );
        return emptyEvidence();
      }
      throw error;
    }
  }

  private async fetchCommits(
    token: string,
    baseUrl: string,
    pullNumber: number,
  ): Promise<CommitInfo[]> {
    const data = await this.fetchPaginatedArray<
      Array<{ sha: string; commit: { message: string } }>[number]
    >(
      token,
      `${baseUrl}/pulls/${pullNumber}/commits`,
      "required",
      "pull request commits",
    );
    return data.map((c) => ({ sha: c.sha, message: c.commit.message }));
  }

  private async fetchChangedFiles(
    token: string,
    baseUrl: string,
    pullNumber: number,
  ): Promise<ChangedFile[]> {
    const data = await this.fetchPaginatedArray<
      Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }>[number]
    >(
      token,
      `${baseUrl}/pulls/${pullNumber}/files`,
      "required",
      "pull request changed files",
    );
    return data.map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }

  private async fetchCiEvidence(
    token: string,
    baseUrl: string,
    headSha: string,
  ): Promise<CheckRunSnapshot[]> {
    const [checkRuns, commitStatuses] = await Promise.all([
      this.fetchCheckRuns(token, baseUrl, headSha),
      this.fetchCommitStatuses(token, baseUrl, headSha),
    ]);
    return [...checkRuns, ...commitStatuses];
  }

  private async fetchCheckRuns(
    token: string,
    baseUrl: string,
    headSha: string,
  ): Promise<CheckRunSnapshot[]> {
    const data = await this.fetchPaginatedArray<
      Array<{
        name: string;
        status: "queued" | "in_progress" | "completed";
        conclusion: string | null;
      }>[number]
    >(
      token,
      `${baseUrl}/commits/${headSha}/check-runs`,
      "required",
      "check runs",
      (json) => {
        if (!json || typeof json !== "object" || !("check_runs" in json)) {
          return [];
        }
        const payload = json as {
          check_runs?: Array<{
            name: string;
            status: "queued" | "in_progress" | "completed";
            conclusion: string | null;
          }>;
        };
        return payload.check_runs ?? [];
      },
    );

    return data.map((cr) => ({
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion as CheckRunSnapshot["conclusion"],
    }));
  }

  private async fetchCommitStatuses(
    token: string,
    baseUrl: string,
    headSha: string,
  ): Promise<CheckRunSnapshot[]> {
    const statuses = await this.fetchPaginatedArray<
      Array<{
        context?: string;
        state: "error" | "failure" | "pending" | "success";
        description?: string;
      }>[number]
    >(
      token,
      `${baseUrl}/commits/${headSha}/statuses`,
      "required",
      "commit statuses",
    );

    return statuses.map((status, index) => ({
      name:
        status.context || status.description || `commit-status-${index + 1}`,
      status: status.state === "pending" ? "queued" : "completed",
      conclusion:
        status.state === "success"
          ? "success"
          : status.state === "pending"
            ? null
            : status.state === "error"
              ? "failure"
              : "failure",
    }));
  }

  private async fetchPullRequestReviewComments(
    token: string,
    baseUrl: string,
    pullNumber: number,
  ): Promise<ReviewComment[]> {
    const data = await this.fetchPaginatedArray<
      Array<{ id: number; user: { login: string }; body: string }>[number]
    >(
      token,
      `${baseUrl}/pulls/${pullNumber}/comments`,
      "required",
      "pull request review comments",
    );
    return data.map((c) => ({ id: c.id, author: c.user.login, body: c.body }));
  }

  private async fetchIssueComments(
    token: string,
    baseUrl: string,
    pullNumber: number,
  ): Promise<ReviewComment[]> {
    const data = await this.fetchPaginatedArray<
      Array<{ id: number; user: { login: string }; body: string }>[number]
    >(
      token,
      `${baseUrl}/issues/${pullNumber}/comments`,
      "required",
      "issue comments",
    );
    return data.map((c) => ({ id: c.id, author: c.user.login, body: c.body }));
  }

  private async fetchPolicyText(
    token: string,
    baseUrl: string,
    ref: string,
  ): Promise<string | undefined> {
    const content = await this.fetchFileContent(
      token,
      baseUrl,
      ".agent-pr-verifier.yml",
      ref,
      "optional",
      "policy",
    );
    return content ?? undefined;
  }

  private async fetchRepositoryScripts(
    token: string,
    baseUrl: string,
    headSha: string,
    baseBranch: string,
    defaultBranch: string | undefined,
  ): Promise<Record<string, string> | undefined> {
    const refs = unique(
      [headSha, baseBranch, defaultBranch].filter((value): value is string =>
        Boolean(value),
      ),
    );
    for (const ref of refs) {
      const packageJsonContent = await this.fetchFileContent(
        token,
        baseUrl,
        "package.json",
        ref,
        "optional",
        "package scripts",
      );
      const scripts = parsePackageScripts(packageJsonContent ?? undefined);
      if (scripts) {
        return scripts;
      }
    }
    return undefined;
  }

  private async fetchRepositoryContextFiles(
    token: string,
    baseUrl: string,
    changedFiles: ChangedFile[],
    ref: string,
    findings: string[],
  ): Promise<Record<string, string>> {
    const changedSourceFiles = changedFiles
      .filter((file) => isSourceFile(file.path))
      .map((file) => normalizePath(file.path));
    if (changedSourceFiles.length === 0) {
      return {};
    }

    const treePaths = await this.fetchRepositoryTreePaths(token, baseUrl, ref);
    const testPaths = treePaths.filter((path) => isTestFile(path));
    const sourcePaths = treePaths.filter((path) => isSourceFile(path));

    const nearbyTests = this.findNearbyTests(changedSourceFiles, testPaths);
    const stemTests = this.findStemTests(changedSourceFiles, testPaths);
    const probableDependents = this.findProbableDependentSources(
      changedSourceFiles,
      sourcePaths,
    );

    const initialContextPaths = unique([
      ...changedSourceFiles,
      ...nearbyTests,
      ...stemTests,
      ...probableDependents,
    ]);
    const selectedInitialPaths = this.selectContextPaths(
      initialContextPaths,
      findings,
      "initial",
    );
    const repositoryFiles = await this.fetchSourceFileContents(
      token,
      baseUrl,
      selectedInitialPaths,
      ref,
    );

    const dependentPaths = this.findDirectImportDependents(
      changedSourceFiles,
      repositoryFiles,
    );
    const dependentTests = unique([
      ...this.findNearbyTests(dependentPaths, testPaths),
      ...this.findStemTests(dependentPaths, testPaths),
    ]);
    const additionalPaths = dependentTests.filter(
      (path) => !(path in repositoryFiles),
    );
    const selectedAdditionalPaths = this.selectContextPaths(
      additionalPaths,
      findings,
      "dependent-tests",
    );
    const additionalFiles = await this.fetchSourceFileContents(
      token,
      baseUrl,
      selectedAdditionalPaths,
      ref,
    );

    return { ...repositoryFiles, ...additionalFiles };
  }

  private findNearbyTests(
    changedSourceFiles: string[],
    testPaths: string[],
  ): string[] {
    const result: string[] = [];
    for (const sourcePath of changedSourceFiles) {
      const sourceDir = dirname(sourcePath);
      for (const testPath of testPaths) {
        const testDir = dirname(testPath);
        if (!sourceDir || !testDir) {
          continue;
        }
        if (testDir.includes(sourceDir) || sourceDir.includes(testDir)) {
          result.push(testPath);
        }
      }
    }
    return unique(result);
  }

  private findStemTests(
    changedSourceFiles: string[],
    testPaths: string[],
  ): string[] {
    const stems = changedSourceFiles.map((path) =>
      basenameWithoutExtension(path).replace(
        /\.(service|controller|module)$/,
        "",
      ),
    );
    return unique(
      testPaths.filter((path) =>
        stems.some(
          (stem) =>
            stem.length > 1 && basenameWithoutExtension(path).includes(stem),
        ),
      ),
    );
  }

  private findProbableDependentSources(
    changedSourceFiles: string[],
    sourcePaths: string[],
  ): string[] {
    const stems = changedSourceFiles.map((path) =>
      basenameWithoutExtension(path),
    );
    const topLevels = changedSourceFiles.map((path) => topLevelDirectory(path));
    return unique(
      sourcePaths.filter((candidate) => {
        if (changedSourceFiles.includes(candidate) || isTestFile(candidate)) {
          return false;
        }
        const candidateTopLevel = topLevelDirectory(candidate);
        const candidateStem = basenameWithoutExtension(candidate);
        return (
          topLevels.includes(candidateTopLevel) ||
          stems.some((stem) => candidateStem.includes(stem))
        );
      }),
    );
  }

  private findDirectImportDependents(
    changedSourceFiles: string[],
    repositoryFiles: Record<string, string>,
  ): string[] {
    const changedSourceSet = new Set(changedSourceFiles);
    const dependents = new Set<string>();
    for (const [path, content] of Object.entries(repositoryFiles)) {
      if (!isSourceFile(path) || isTestFile(path)) {
        continue;
      }
      const imports = parseImports(path, content);
      for (const imported of imports) {
        const resolved = resolveImport(path, imported, repositoryFiles);
        if (resolved && changedSourceSet.has(resolved)) {
          dependents.add(path);
        }
      }
    }
    return [...dependents];
  }

  private selectContextPaths(
    paths: string[],
    findings: string[],
    bucket: string,
  ): string[] {
    if (paths.length <= MAX_REPOSITORY_CONTEXT_FILES) {
      return paths;
    }
    findings.push(
      `repository-context-truncated:${bucket}:${paths.length}->${MAX_REPOSITORY_CONTEXT_FILES}`,
    );
    return paths.slice(0, MAX_REPOSITORY_CONTEXT_FILES);
  }

  private async fetchFileContent(
    token: string,
    baseUrl: string,
    path: string,
    ref: string,
    mode: ListFetchMode,
    label: string,
  ): Promise<string | null> {
    const url = this.buildContentsUrl(baseUrl, path, ref);
    const data = await this.fetchJson<{
      content?: string;
      encoding?: string;
    } | null>(token, url, mode, label, [404]);
    if (
      !data ||
      !("content" in data) ||
      !data.content ||
      data.encoding !== "base64"
    ) {
      return null;
    }
    return decodeBase64Content(data.content);
  }

  private buildContentsUrl(baseUrl: string, path: string, ref: string): string {
    const encodedPath = normalizePath(path)
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const url = new URL(`${baseUrl}/contents/${encodedPath}`);
    url.searchParams.set("ref", ref);
    return url.toString();
  }

  private async fetchRepositoryTreePaths(
    token: string,
    baseUrl: string,
    ref: string,
  ): Promise<string[]> {
    const url = new URL(`${baseUrl}/git/trees/${encodeURIComponent(ref)}`);
    url.searchParams.set("recursive", "1");
    const data = await this.fetchJson<{
      tree?: Array<{ path: string; type: string }>;
    }>(token, url.toString(), "optional", "repository tree");
    if (!data?.tree) {
      return [];
    }
    return data.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => normalizePath(entry.path));
  }

  private async fetchDefaultBranch(
    token: string,
    baseUrl: string,
  ): Promise<string | undefined> {
    const data = await this.fetchJson<{ default_branch?: string }>(
      token,
      baseUrl,
      "optional",
      "repository metadata",
    );
    return data?.default_branch;
  }

  private async fetchSourceFileContents(
    token: string,
    baseUrl: string,
    paths: string[],
    ref: string,
  ): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    await Promise.all(
      paths.map(async (path) => {
        const content = await this.fetchFileContent(
          token,
          baseUrl,
          path,
          ref,
          "optional",
          "repository file content",
        );
        if (content !== null) {
          results[path] = content;
        }
      }),
    );
    return results;
  }

  private async fetchPaginatedArray<T>(
    token: string,
    url: string,
    mode: ListFetchMode,
    label: string,
    extractor?: (json: unknown) => T[],
  ): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    while (true) {
      const pageUrl = new URL(url);
      pageUrl.searchParams.set("per_page", String(GITHUB_PAGE_SIZE));
      pageUrl.searchParams.set("page", String(page));
      const data = await this.fetchJson<unknown>(
        token,
        pageUrl.toString(),
        mode,
        label,
      );
      if (!data) {
        return [];
      }
      const pageItems = extractor
        ? extractor(data)
        : Array.isArray(data)
          ? (data as T[])
          : [];
      items.push(...pageItems);
      if (pageItems.length < GITHUB_PAGE_SIZE) {
        break;
      }
      page += 1;
    }
    return items;
  }

  private async fetchJson<T>(
    token: string,
    url: string,
    mode: ListFetchMode,
    label: string,
    allowStatuses: number[] = [],
  ): Promise<T | null> {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "User-Agent": "mergesafe",
        },
      });
      if (!response.ok) {
        if (allowStatuses.includes(response.status)) {
          return null;
        }
        const message = `GitHub API responded ${response.status} for ${label}`;
        if (mode === "optional") {
          this.logger.warn(message);
          return null;
        }
        throw new EvidenceFetchError(message);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (mode === "optional") {
        this.logger.warn(`GitHub API request failed for ${label}`);
        return null;
      }
      throw new EvidenceFetchError(`GitHub API request failed for ${label}`);
    }
  }

  private async resolveToken(
    installationId: number | undefined,
    owner: string,
    repoName: string,
    pullNumber: number,
  ): Promise<string> {
    if (process.env.GITHUB_TOKEN) {
      return process.env.GITHUB_TOKEN;
    }
    if (!installationId) {
      throw new EvidenceFetchError(
        `No GitHub credentials available for ${owner}/${repoName}#${pullNumber}: missing GITHUB_TOKEN and installation id`,
      );
    }
    const minted = await this.mintInstallationToken(installationId);
    if (!minted) {
      throw new EvidenceFetchError(
        `Failed to mint installation token for ${owner}/${repoName}#${pullNumber}`,
      );
    }
    return minted;
  }

  private async mintInstallationToken(
    installationId: number,
  ): Promise<string | null> {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_PRIVATE_KEY;
    if (!appId || !privateKey) {
      throw new EvidenceFetchError(
        "GITHUB_APP_ID and GITHUB_PRIVATE_KEY are required to mint installation tokens",
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    const sig = signer
      .sign(createPrivateKey(privateKey.replace(/\\n/g, "\n")))
      .toString("base64url");
    const jwt = `${header}.${payload}.${sig}`;

    try {
      const response = await fetch(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + jwt,
            Accept: "application/vnd.github+json",
            "User-Agent": "mergesafe",
          },
        },
      );

      if (!response.ok) {
        throw new EvidenceFetchError(
          `Failed to mint installation token: ${response.status}`,
        );
      }

      const json = (await response.json()) as { token: string };
      return json.token;
    } catch (error) {
      if (error instanceof EvidenceFetchError) {
        throw error;
      }
      throw new EvidenceFetchError("Installation token mint request failed");
    }
  }

  private isLenientEvidenceMode(): boolean {
    if (
      process.env.MERGESAFE_ALLOW_EMPTY_EVIDENCE === "true" ||
      process.env.MERGESAFE_ALLOW_EMPTY_EVIDENCE === "1"
    ) {
      return true;
    }
    return (
      process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development"
    );
  }
}
