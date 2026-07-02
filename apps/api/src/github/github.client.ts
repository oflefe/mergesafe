import { Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, createSign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { VerificationRequest, VerificationResult } from '../domain/types';

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
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
    const token = request.installationId ? await this.getInstallationToken(request.installationId) : null;
    if (!token) {
      this.logger.log(`Verification comment for ${request.repoOwner}/${request.repoName}#${request.pullNumber}\n${body}`);
      return existingCommentId ?? this.commentSequence++;
    }

    if (existingCommentId) {
      await this.request(
        token,
        `https://api.github.com/repos/${request.repoOwner}/${request.repoName}/issues/comments/${existingCommentId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ body }),
        },
      );
      return existingCommentId;
    }

    const response = await this.request(
      token,
      `https://api.github.com/repos/${request.repoOwner}/${request.repoName}/issues/${request.pullNumber}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ body }),
      },
    );
    return response.id as number;
  }

  async createOrUpdateCheckRun(
    request: VerificationRequest,
    result: VerificationResult,
  ): Promise<void> {
    const token = request.installationId ? await this.getInstallationToken(request.installationId) : null;
    const payload = {
      name: 'Agentic PR Verification',
      head_sha: request.commits[0]?.sha,
      status: 'completed',
      conclusion: result.checkConclusion,
      output: {
        title: `${result.verdict.toUpperCase()} — ${result.riskScore}/100`,
        summary: result.ciSummary,
        text: result.commentBody,
      },
    };

    if (!token) {
      this.logger.log(`Check run payload: ${JSON.stringify(payload)}`);
      return;
    }

    await this.request(
      token,
      `https://api.github.com/repos/${request.repoOwner}/${request.repoName}/check-runs`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          Accept: 'application/vnd.github+json',
        },
      },
    );
  }

  private async getInstallationToken(installationId: number): Promise<string | null> {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_PRIVATE_KEY;
    if (!appId || !privateKey) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({
        iat: now - 60,
        exp: now + 600,
        iss: appId,
      }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = signer
      .sign(createPrivateKey(privateKey.replace(/\\n/g, '\n')))
      .toString('base64url');
    const jwt = `${header}.${payload}.${signature}`;

    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + jwt,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'mergesafe',
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
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + token,
        'User-Agent': 'mergesafe',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API request failed (${response.status}) for ${url}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
