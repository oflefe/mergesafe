import { Injectable, Logger } from "@nestjs/common";
import { createPrivateKey, createSign } from "node:crypto";
import { Buffer } from "node:buffer";
import { VerificationRequest, VerificationResult } from "../domain/types";

const VERIFICATION_COMMENT_MARKER = "<!-- mergesafe-verification -->";
const CHECK_RUN_NAME = "MergeSafe Verification";

interface GitHubIssueComment {
  id: number;
  body: string;
}

interface GitHubCheckRun {
  id: number;
  name: string;
  head_sha?: string;
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

@Injectable()
export class GitHubAppClient {
  private readonly logger = new Logger(GitHubAppClient.name);
  private commentSequence = 1;

  async upsertVerificationComment(
    request: VerificationRequest,
    body: string,
    existingCommentId?: number,
  ): Promise<number> {
    const token = request.installationId
      ? await this.getInstallationToken(request.installationId)
      : null;
    if (!token) {
      this.logger.log(
        `Verification comment updated for ${request.repoOwner}/${request.repoName}#${request.pullNumber}`,
      );
      return existingCommentId ?? this.commentSequence++;
    }

    const commentBody = this.ensureCommentMarker(body);
    const targetCommentId =
      existingCommentId ??
      (await this.findExistingVerificationCommentId(token, request));

    if (targetCommentId) {
      await this.request(
        token,
        `https://api.github.com/repos/${request.repoOwner}/${request.repoName}/issues/comments/${targetCommentId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ body: commentBody }),
        },
      );
      return targetCommentId;
    }

    const response = await this.request(
      token,
      `https://api.github.com/repos/${request.repoOwner}/${request.repoName}/issues/${request.pullNumber}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body: commentBody }),
      },
    );
    return this.readNumericId(response, "verification comment");
  }

  async createOrUpdateCheckRun(
    request: VerificationRequest,
    result: VerificationResult,
    existingCheckRunId?: number,
  ): Promise<number | undefined> {
    const token = request.installationId
      ? await this.getInstallationToken(request.installationId)
      : null;
    const payload = {
      name: CHECK_RUN_NAME,
      head_sha: request.headSha,
      status: "completed",
      conclusion: result.checkConclusion,
      output: {
        title: `${result.verdict.toUpperCase()} — ${result.riskScore}/100`,
        summary: result.ciSummary,
        text: result.commentBody,
      },
    };

    if (!token) {
      this.logger.log(
        `Check run recorded for ${request.repoOwner}/${request.repoName}#${request.pullNumber}`,
      );
      return undefined;
    }

    const targetCheckRunId =
      existingCheckRunId ??
      (await this.findExistingCheckRunIdForHead(token, request));

    if (targetCheckRunId) {
      await this.request(
        token,
        `https://api.github.com/repos/${request.repoOwner}/${request.repoName}/check-runs/${targetCheckRunId}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
          headers: {
            Accept: "application/vnd.github+json",
          },
        },
      );
      return targetCheckRunId;
    }

    const response = await this.request(
      token,
      `https://api.github.com/repos/${request.repoOwner}/${request.repoName}/check-runs`,
      {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          Accept: "application/vnd.github+json",
        },
      },
    );
    return this.readOptionalNumericId(response.id);
  }

  private ensureCommentMarker(body: string): string {
    if (body.includes(VERIFICATION_COMMENT_MARKER)) {
      return body;
    }
    return `${VERIFICATION_COMMENT_MARKER}\n${body}`;
  }

  private async findExistingVerificationCommentId(
    token: string,
    request: VerificationRequest,
  ): Promise<number | undefined> {
    let page = 1;
    while (true) {
      const response = await this.requestArray(
        token,
        `https://api.github.com/repos/${request.repoOwner}/${request.repoName}/issues/${request.pullNumber}/comments?per_page=100&page=${page}`,
        {
          method: "GET",
        },
        "issue comments",
      );
      if (response.length === 0) {
        return undefined;
      }

      const matching = response
        .filter(this.isIssueComment)
        .filter((comment) =>
          comment.body.includes(VERIFICATION_COMMENT_MARKER),
        );

      if (matching.length > 0) {
        return matching[matching.length - 1].id;
      }

      if (response.length < 100) {
        return undefined;
      }
      page += 1;
    }
  }

  private async findExistingCheckRunIdForHead(
    token: string,
    request: VerificationRequest,
  ): Promise<number | undefined> {
    const response = await this.request(
      token,
      `https://api.github.com/repos/${request.repoOwner}/${request.repoName}/commits/${request.headSha}/check-runs?per_page=100`,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
        },
      },
    );

    const checkRunsRaw = response.check_runs;
    if (!Array.isArray(checkRunsRaw)) {
      return undefined;
    }

    const matching = checkRunsRaw
      .filter(this.isCheckRun)
      .filter(
        (checkRun) =>
          checkRun.name === CHECK_RUN_NAME &&
          (!checkRun.head_sha || checkRun.head_sha === request.headSha),
      );

    if (matching.length === 0) {
      return undefined;
    }

    return matching[matching.length - 1].id;
  }

  private async getInstallationToken(
    installationId: number,
  ): Promise<string | null> {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_PRIVATE_KEY;
    if (!appId || !privateKey) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(
      JSON.stringify({
        iat: now - 60,
        exp: now + 600,
        iss: appId,
      }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    const signature = signer
      .sign(createPrivateKey(privateKey.replace(/\\n/g, "\n")))
      .toString("base64url");
    const jwt = `${header}.${payload}.${signature}`;

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
      throw new Error(`Failed to mint installation token: ${response.status}`);
    }

    const json = (await response.json()) as { token: string };
    return json.token;
  }

  private async request(
    token: string,
    url: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: "Bearer " + token,
          "User-Agent": "mergesafe",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new Error(
        `GitHub API request failed (${this.requestLabel(init.method)} ${this.safeUrlPath(url)}): ${this.errorMessage(error)}`,
      );
    }

    if (!response.ok) {
      const details = await this.safeReadResponseBody(response);
      throw new Error(
        `GitHub API request failed (${response.status}) for ${this.requestLabel(init.method)} ${this.safeUrlPath(url)}${details ? `: ${details}` : ""}`,
      );
    }

    if (response.status === 204) {
      return {};
    }

    const text = await response.text();
    if (!text) {
      return {};
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `GitHub API request failed to parse response for ${this.requestLabel(init.method)} ${this.safeUrlPath(url)}`,
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `GitHub API request returned an unexpected payload for ${this.requestLabel(init.method)} ${this.safeUrlPath(url)}`,
      );
    }

    return parsed as Record<string, unknown>;
  }

  private async requestArray(
    token: string,
    url: string,
    init: RequestInit,
    resourceLabel: string,
  ): Promise<unknown[]> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: "Bearer " + token,
          "User-Agent": "mergesafe",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new Error(
        `GitHub API request failed (${this.requestLabel(init.method)} ${this.safeUrlPath(url)}): ${this.errorMessage(error)}`,
      );
    }

    if (!response.ok) {
      const details = await this.safeReadResponseBody(response);
      throw new Error(
        `GitHub API request failed (${response.status}) for ${this.requestLabel(init.method)} ${this.safeUrlPath(url)}${details ? `: ${details}` : ""}`,
      );
    }

    const text = await response.text();
    if (!text) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        `GitHub API request failed to parse ${resourceLabel} response for ${this.requestLabel(init.method)} ${this.safeUrlPath(url)}`,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        `GitHub API request returned an unexpected ${resourceLabel} payload for ${this.requestLabel(init.method)} ${this.safeUrlPath(url)}`,
      );
    }

    return parsed;
  }

  private readNumericId(
    payload: Record<string, unknown>,
    resourceLabel: string,
  ): number {
    const id = this.readOptionalNumericId(payload.id);
    if (typeof id === "number") {
      return id;
    }
    throw new Error(`GitHub API request returned ${resourceLabel} without id`);
  }

  private readOptionalNumericId(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  private isIssueComment(comment: unknown): comment is GitHubIssueComment {
    if (!comment || typeof comment !== "object") {
      return false;
    }
    const candidate = comment as Partial<GitHubIssueComment>;
    return (
      typeof candidate.id === "number" && typeof candidate.body === "string"
    );
  }

  private isCheckRun(checkRun: unknown): checkRun is GitHubCheckRun {
    if (!checkRun || typeof checkRun !== "object") {
      return false;
    }
    const candidate = checkRun as Partial<GitHubCheckRun>;
    return (
      typeof candidate.id === "number" && typeof candidate.name === "string"
    );
  }

  private requestLabel(method: string | undefined): string {
    return (method ?? "GET").toUpperCase();
  }

  private safeUrlPath(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return url;
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private async safeReadResponseBody(response: Response): Promise<string> {
    try {
      const text = (await response.text()).trim();
      if (!text) {
        return "";
      }
      return text.slice(0, 300);
    } catch {
      return "";
    }
  }
}
