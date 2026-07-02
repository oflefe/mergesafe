import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { GitHubAppClient } from "../../src/github/github.client";
import { GitHubEvidenceFetcher } from "../../src/github/github-evidence-fetcher";
import { DATABASE_POOL } from "../../src/storage/database.pool";
import { VerificationRepository } from "../../src/storage/verification.repository";
import { createTestDatabasePool } from "../helpers/create-test-database";
import {
  githubWebhookPayload,
  fetchedEvidence,
  computeWebhookSignature,
} from "../fixtures/github-webhook.fixture";

class FakeGitHubClient {
  comments: Array<{ body: string; existingCommentId?: number }> = [];
  checks: Array<{ conclusion: string; summary: string }> = [];

  async upsertVerificationComment(
    _request: any,
    body: string,
    existingCommentId?: number,
  ) {
    this.comments.push({ body, existingCommentId });
    return existingCommentId ?? 101;
  }

  async createOrUpdateCheckRun(_request: any, result: any) {
    this.checks.push({
      conclusion: result.checkConclusion,
      summary: result.ciSummary,
    });
    return 501;
  }
}

class FakeEvidenceFetcher {
  calls: Array<{
    owner: string;
    repoName: string;
    pullNumber: number;
    headSha: string;
    baseBranch: string;
    installationId?: number;
  }> = [];

  evidence = fetchedEvidence;

  async fetchPullRequestEvidence(
    owner: string,
    repoName: string,
    pullNumber: number,
    headSha: string,
    baseBranch: string,
    installationId?: number,
  ) {
    this.calls.push({
      owner,
      repoName,
      pullNumber,
      headSha,
      baseBranch,
      installationId,
    });
    return this.evidence;
  }
}

function toBase64(content: string): string {
  return Buffer.from(content, "utf-8").toString("base64");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function buildApp(
  fakeGitHubClient: FakeGitHubClient,
  fakeEvidenceFetcher?: FakeEvidenceFetcher,
) {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GitHubAppClient)
    .useValue(fakeGitHubClient)
    .overrideProvider(DATABASE_POOL)
    .useValue(createTestDatabasePool());

  if (fakeEvidenceFetcher) {
    builder
      .overrideProvider(GitHubEvidenceFetcher)
      .useValue(fakeEvidenceFetcher);
  }

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { rawBody: true },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, moduleRef };
}

describe("GitHubWebhookController", () => {
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = "";
    delete process.env.GITHUB_TOKEN;
    jest.restoreAllMocks();
  });

  it("ignores unsupported events", async () => {
    const { app } = await buildApp(
      new FakeGitHubClient(),
      new FakeEvidenceFetcher(),
    );

    await request(app.getHttpServer())
      .post("/webhooks/github")
      .set("x-github-event", "push")
      .send(githubWebhookPayload)
      .expect(202, { accepted: false });

    await app.close();
  });

  it("ignores unsupported pull_request actions", async () => {
    const { app } = await buildApp(
      new FakeGitHubClient(),
      new FakeEvidenceFetcher(),
    );

    await request(app.getHttpServer())
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .send({ ...githubWebhookPayload, action: "closed" })
      .expect(202, { accepted: false });

    await app.close();
  });

  it("accepts opened, synchronize, and reopened actions", async () => {
    for (const action of ["opened", "synchronize", "reopened"]) {
      const { app } = await buildApp(
        new FakeGitHubClient(),
        new FakeEvidenceFetcher(),
      );

      await request(app.getHttpServer())
        .post("/webhooks/github")
        .set("x-github-event", "pull_request")
        .send({ ...githubWebhookPayload, action })
        .expect(202)
        .expect((res) => {
          expect(res.body.accepted).toBe(true);
        });

      await app.close();
    }
  });

  it("accepts a valid webhook signature", async () => {
    const secret = "test-secret";
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    const { app } = await buildApp(
      new FakeGitHubClient(),
      new FakeEvidenceFetcher(),
    );

    const bodyJson = JSON.stringify(githubWebhookPayload);
    const signature = computeWebhookSignature(bodyJson, secret);

    await request(app.getHttpServer())
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .set("x-hub-signature-256", signature)
      .set("Content-Type", "application/json")
      .send(bodyJson)
      .expect(202)
      .expect((res) => {
        expect(res.body.accepted).toBe(true);
      });

    await app.close();
  });

  it("rejects an invalid webhook signature", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "test-secret";
    const { app } = await buildApp(
      new FakeGitHubClient(),
      new FakeEvidenceFetcher(),
    );

    await request(app.getHttpServer())
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .set("x-hub-signature-256", "sha256=invalidsignature")
      .send(githubWebhookPayload)
      .expect(401);

    await app.close();
  });

  it("transforms a real GitHub webhook fixture into a complete VerificationRequest", async () => {
    const fakeGitHubClient = new FakeGitHubClient();
    const { app, moduleRef } = await buildApp(
      fakeGitHubClient,
      new FakeEvidenceFetcher(),
    );

    await request(app.getHttpServer())
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .send(githubWebhookPayload)
      .expect(202, { accepted: true, pullRequest: "octo/demo#7" });

    const repository = moduleRef.get(VerificationRepository);
    const saved = await repository.getPullRequest("octo/demo#7");

    expect(saved?.lastRequest).toMatchObject({
      repoOwner: "octo",
      repoName: "demo",
      repoId: "octo/demo",
      pullNumber: 7,
      title: "Auth hardening",
      body: "This PR updates auth checks.",
      branchName: "copilot/auth-hardening",
      baseBranch: "main",
      headSha: "abc123def456",
      author: "copilot-swe-agent[bot]",
      action: "opened",
      installationId: 42,
      commits: fetchedEvidence.commits,
      changedFiles: fetchedEvidence.changedFiles,
      checkRuns: fetchedEvidence.checkRuns,
      reviewComments: fetchedEvidence.reviewComments,
    });

    expect(fakeGitHubClient.comments).toHaveLength(1);
    expect(fakeGitHubClient.checks).toHaveLength(1);
    expect(fakeGitHubClient.comments[0].body).toContain(
      "Agentic PR Verification",
    );
    expect(saved?.latestVerification?.verdict).toBe("fail");

    await app.close();
  });

  it("accepts pull_request webhooks and posts exactly one verification comment", async () => {
    const fakeGitHubClient = new FakeGitHubClient();
    const { app, moduleRef } = await buildApp(
      fakeGitHubClient,
      new FakeEvidenceFetcher(),
    );

    await request(app.getHttpServer())
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .send(githubWebhookPayload)
      .expect(202);

    expect(fakeGitHubClient.comments).toHaveLength(1);
    expect(fakeGitHubClient.checks).toHaveLength(1);
    expect(fakeGitHubClient.comments[0].body).toContain(
      "Agentic PR Verification",
    );

    const repository = moduleRef.get(VerificationRepository);
    const saved = await repository.getPullRequest("octo/demo#7");
    expect(saved?.latestVerification?.verdict).toBe("fail");

    await request(app.getHttpServer())
      .get("/repos")
      .expect(200, [{ id: "octo/demo", owner: "octo", name: "demo" }]);

    await request(app.getHttpServer())
      .get("/prs/octo%2Fdemo%237/verification")
      .expect(200);

    await app.close();
  });

  it("GIVEN a realistic webhook WHEN using the real evidence fetcher THEN it fetches evidence enqueues verification and saves a result", async () => {
    process.env.GITHUB_TOKEN = "token";

    jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const path = `${url.pathname}?${url.searchParams.toString()}`;

      if (path.startsWith("/repos/octo/demo/pulls/7/commits")) {
        return jsonResponse([
          {
            sha: "abc123def456",
            commit: { message: "feat: add auth hardening" },
          },
        ]);
      }

      if (path.startsWith("/repos/octo/demo/pulls/7/files")) {
        return jsonResponse([
          {
            filename: "src/auth/session.service.ts",
            status: "modified",
            additions: 20,
            deletions: 5,
            patch: "@@ -1 +1 @@",
          },
        ]);
      }

      if (path.startsWith("/repos/octo/demo/commits/abc123def456/check-runs")) {
        return jsonResponse({
          check_runs: [
            { name: "ci", status: "completed", conclusion: "success" },
          ],
        });
      }

      if (path.startsWith("/repos/octo/demo/commits/abc123def456/statuses")) {
        return jsonResponse([{ context: "lint", state: "success" }]);
      }

      if (path.startsWith("/repos/octo/demo/pulls/7/comments")) {
        return jsonResponse([]);
      }

      if (path.startsWith("/repos/octo/demo/issues/7/comments")) {
        return jsonResponse([]);
      }

      if (url.pathname === "/repos/octo/demo") {
        return jsonResponse({ default_branch: "main" });
      }

      if (
        url.pathname === "/repos/octo/demo/git/trees/abc123def456" &&
        url.searchParams.get("recursive") === "1"
      ) {
        return jsonResponse({
          tree: [
            { path: "src/auth/session.service.ts", type: "blob" },
            { path: "tests/auth/session.service.spec.ts", type: "blob" },
          ],
        });
      }

      if (
        url.pathname === "/repos/octo/demo/contents/package.json" &&
        url.searchParams.get("ref") === "abc123def456"
      ) {
        return jsonResponse({
          content: toBase64(
            JSON.stringify({
              scripts: { test: "jest", "test:unit": "jest unit" },
            }),
          ),
          encoding: "base64",
        });
      }

      if (
        url.pathname === "/repos/octo/demo/contents/.agent-pr-verifier.yml" &&
        url.searchParams.get("ref") === "main"
      ) {
        return new Response("", { status: 404 });
      }

      if (
        url.pathname ===
          "/repos/octo/demo/contents/src/auth/session.service.ts" &&
        url.searchParams.get("ref") === "abc123def456"
      ) {
        return jsonResponse({
          content: toBase64("export const session = () => true;"),
          encoding: "base64",
        });
      }

      if (
        url.pathname ===
          "/repos/octo/demo/contents/tests/auth/session.service.spec.ts" &&
        url.searchParams.get("ref") === "abc123def456"
      ) {
        return jsonResponse({
          content: toBase64(
            "import { session } from '../../src/auth/session.service'; describe('session', () => { expect(session()).toBe(true); });",
          ),
          encoding: "base64",
        });
      }

      throw new Error(`Unhandled URL: ${url.toString()}`);
    });

    const fakeGitHubClient = new FakeGitHubClient();
    const { app, moduleRef } = await buildApp(fakeGitHubClient);

    await request(app.getHttpServer())
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .send(githubWebhookPayload)
      .expect(202, { accepted: true, pullRequest: "octo/demo#7" });

    const repository = moduleRef.get(VerificationRepository);
    const saved = await repository.getPullRequest("octo/demo#7");

    expect(saved?.lastRequest).toMatchObject({
      commits: [{ sha: "abc123def456", message: "feat: add auth hardening" }],
      changedFiles: [
        {
          path: "src/auth/session.service.ts",
          status: "modified",
          additions: 20,
          deletions: 5,
        },
      ],
      checkRuns: [
        { name: "ci", status: "completed", conclusion: "success" },
        { name: "lint", status: "completed", conclusion: "success" },
      ],
      repositoryScripts: { test: "jest", "test:unit": "jest unit" },
    });
    expect(saved?.lastRequest?.repositoryFiles).toEqual(
      expect.objectContaining({
        "src/auth/session.service.ts": "export const session = () => true;",
        "tests/auth/session.service.spec.ts":
          "import { session } from '../../src/auth/session.service'; describe('session', () => { expect(session()).toBe(true); });",
      }),
    );
    expect(saved?.latestVerification).toBeDefined();
    expect(fakeGitHubClient.comments).toHaveLength(1);
    expect(fakeGitHubClient.checks).toHaveLength(1);

    await app.close();
  });

  it("GIVEN a persisted pull request WHEN recheck is called THEN it reloads PR identity and refetches evidence", async () => {
    const fakeGitHubClient = new FakeGitHubClient();
    const fakeEvidenceFetcher = new FakeEvidenceFetcher();
    const { app, moduleRef } = await buildApp(fakeGitHubClient, fakeEvidenceFetcher);

    await request(app.getHttpServer())
      .post("/webhooks/github")
      .set("x-github-event", "pull_request")
      .send(githubWebhookPayload)
      .expect(202);

    fakeEvidenceFetcher.calls = [];
    fakeEvidenceFetcher.evidence = {
      ...fetchedEvidence,
      changedFiles: [
        {
          path: "src/auth/recheck.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
        },
      ],
    };

    await request(app.getHttpServer())
      .post("/prs/octo%2Fdemo%237/recheck")
      .send({
        repositoryFiles: {
          "stale/file.ts": "should not be used",
        },
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.rechecked).toBe(true);
      });

    expect(fakeEvidenceFetcher.calls).toHaveLength(1);
    expect(fakeEvidenceFetcher.calls[0]).toEqual({
      owner: "octo",
      repoName: "demo",
      pullNumber: 7,
      headSha: "abc123def456",
      baseBranch: "main",
      installationId: 42,
    });

    const repository = moduleRef.get(VerificationRepository);
    const saved = await repository.getPullRequest("octo/demo#7");
    expect(saved?.lastRequest?.action).toBe("recheck");
    expect(saved?.lastRequest?.changedFiles).toEqual([
      {
        path: "src/auth/recheck.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
      },
    ]);
    expect(saved?.lastRequest?.repositoryFiles).not.toEqual({
      "stale/file.ts": "should not be used",
    });

    await app.close();
  });
});
