import { Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, createSign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ChangedFile, CheckRunSnapshot, CommitInfo, ReviewComment } from '../domain/types';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'];
const MAX_CONTENT_FILES = 20;

export interface PullRequestEvidence {
  commits: CommitInfo[];
  changedFiles: ChangedFile[];
  checkRuns: CheckRunSnapshot[];
  reviewComments: ReviewComment[];
  repositoryFiles: Record<string, string>;
  repositoryScripts: Record<string, string> | undefined;
  policyText: string | undefined;
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function decodeBase64Content(encoded: string): string {
  return Buffer.from(encoded.replace(/\n/g, ''), 'base64').toString('utf-8');
}

function parsePackageScripts(content: string | undefined): Record<string, string> | undefined {
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

function emptyEvidence(): PullRequestEvidence {
  return {
    commits: [],
    changedFiles: [],
    checkRuns: [],
    reviewComments: [],
    repositoryFiles: {},
    repositoryScripts: undefined,
    policyText: undefined,
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
    installationId: number | undefined,
  ): Promise<PullRequestEvidence> {
    const token = await this.resolveToken(installationId);

    if (!token) {
      this.logger.log(`No token available for ${owner}/${repoName}#${pullNumber}; skipping evidence fetch`);
      return emptyEvidence();
    }

    const baseUrl = `https://api.github.com/repos/${owner}/${repoName}`;

    const [commits, changedFiles, checkRuns, reviewComments, issueComments, policyFileContent, packageJsonContent] =
      await Promise.all([
        this.fetchCommits(token, baseUrl, pullNumber),
        this.fetchChangedFiles(token, baseUrl, pullNumber),
        this.fetchCheckRuns(token, baseUrl, headSha),
        this.fetchPullRequestReviewComments(token, baseUrl, pullNumber),
        this.fetchIssueComments(token, baseUrl, pullNumber),
        this.fetchFileContent(token, baseUrl, '.agent-pr-verifier.yml'),
        this.fetchFileContent(token, baseUrl, 'package.json'),
      ]);

    const repositoryScripts = parsePackageScripts(packageJsonContent ?? undefined);
    const sourceFilePaths = changedFiles
      .filter((f) => isSourceFile(f.path))
      .slice(0, MAX_CONTENT_FILES)
      .map((f) => f.path);
    const repositoryFiles = await this.fetchSourceFileContents(token, baseUrl, sourceFilePaths, headSha);

    return {
      commits,
      changedFiles,
      checkRuns,
      reviewComments: [...reviewComments, ...issueComments],
      repositoryFiles,
      repositoryScripts,
      policyText: policyFileContent ?? undefined,
    };
  }

  private async fetchCommits(token: string, baseUrl: string, pullNumber: number): Promise<CommitInfo[]> {
    const data = await this.fetchJson<Array<{ sha: string; commit: { message: string } }>>(
      token,
      `${baseUrl}/pulls/${pullNumber}/commits`,
    );
    return (data ?? []).map((c) => ({ sha: c.sha, message: c.commit.message }));
  }

  private async fetchChangedFiles(token: string, baseUrl: string, pullNumber: number): Promise<ChangedFile[]> {
    const data = await this.fetchJson<
      Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>
    >(token, `${baseUrl}/pulls/${pullNumber}/files`);
    return (data ?? []).map((f) => ({
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }

  private async fetchCheckRuns(token: string, baseUrl: string, headSha: string): Promise<CheckRunSnapshot[]> {
    const data = await this.fetchJson<{
      check_runs: Array<{ name: string; status: 'queued' | 'in_progress' | 'completed'; conclusion: string | null }>;
    }>(token, `${baseUrl}/commits/${headSha}/check-runs`);
    return (data?.check_runs ?? []).map((cr) => ({
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion as CheckRunSnapshot['conclusion'],
    }));
  }

  private async fetchPullRequestReviewComments(
    token: string,
    baseUrl: string,
    pullNumber: number,
  ): Promise<ReviewComment[]> {
    const data = await this.fetchJson<Array<{ id: number; user: { login: string }; body: string }>>(
      token,
      `${baseUrl}/pulls/${pullNumber}/comments`,
    );
    return (data ?? []).map((c) => ({ id: c.id, author: c.user.login, body: c.body }));
  }

  private async fetchIssueComments(token: string, baseUrl: string, pullNumber: number): Promise<ReviewComment[]> {
    const data = await this.fetchJson<Array<{ id: number; user: { login: string }; body: string }>>(
      token,
      `${baseUrl}/issues/${pullNumber}/comments`,
    );
    return (data ?? []).map((c) => ({ id: c.id, author: c.user.login, body: c.body }));
  }

  private async fetchFileContent(token: string, baseUrl: string, path: string): Promise<string | null> {
    const data = await this.fetchJson<{ content?: string; encoding?: string } | null>(
      token,
      `${baseUrl}/contents/${path}`,
    );
    if (!data || !('content' in data) || !data.content || data.encoding !== 'base64') {
      return null;
    }
    return decodeBase64Content(data.content);
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
        const content = await this.fetchFileContent(token, baseUrl, `${path}?ref=${ref}`);
        if (content !== null) {
          results[path] = content;
        }
      }),
    );
    return results;
  }

  private async fetchJson<T>(token: string, url: string): Promise<T | null> {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'mergesafe',
        },
      });
      if (!response.ok) {
        this.logger.warn(`GitHub API responded ${response.status} for ${url}`);
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn(`GitHub API request failed for ${url}: ${String(error)}`);
      return null;
    }
  }

  private async resolveToken(installationId: number | undefined): Promise<string | null> {
    if (process.env.GITHUB_TOKEN) {
      return process.env.GITHUB_TOKEN;
    }
    if (!installationId) {
      return null;
    }
    return this.mintInstallationToken(installationId);
  }

  private async mintInstallationToken(installationId: number): Promise<string | null> {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_PRIVATE_KEY;
    if (!appId || !privateKey) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const sig = signer.sign(createPrivateKey(privateKey.replace(/\\n/g, '\n'))).toString('base64url');
    const jwt = `${header}.${payload}.${sig}`;

    const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + jwt,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mergesafe',
      },
    });

    if (!response.ok) {
      this.logger.warn(`Failed to mint installation token: ${response.status}`);
      return null;
    }

    const json = (await response.json()) as { token: string };
    return json.token;
  }
}
