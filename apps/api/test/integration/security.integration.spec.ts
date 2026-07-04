import { Test } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { applySecurity } from "../../src/bootstrap";
import { GitHubAppClient } from "../../src/github/github.client";
import { GitHubEvidenceFetcher } from "../../src/github/github-evidence-fetcher";
import { DATABASE_CLIENT } from "../../src/storage/database.pool";
import { createTestDatabaseClient } from "../helpers/create-test-database";
import {
  computeWebhookSignature,
  githubWebhookPayload,
} from "../fixtures/github-webhook.fixture";

class FakeGitHubClient {
  async upsertVerificationComment() {
    return 101;
  }

  async createOrUpdateCheckRun() {
    return 501;
  }
}

class FakeEvidenceFetcher {
  async fetchPullRequestEvidence() {
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
}

async function buildApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GitHubAppClient)
    .useValue(new FakeGitHubClient())
    .overrideProvider(GitHubEvidenceFetcher)
    .useValue(new FakeEvidenceFetcher())
    .overrideProvider(DATABASE_CLIENT)
    .useValue(createTestDatabaseClient())
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { rawBody: true },
  );

  applySecurity(app, process.env);

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe("production API security", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = envBackup;
  });

  it("GIVEN production mode WHEN API request is missing admin token THEN request is rejected", async () => {
    process.env.NODE_ENV = "production";
    process.env.ADMIN_API_TOKEN = "expected-admin-token";

    const app = await buildApp();

    await request(app.getHttpServer())
      .get("/repos")
      .expect(401)
      .expect({ message: "Unauthorized" });

    await app.close();
  });

  it("GIVEN production mode WHEN webhook request has valid signature but no admin token THEN webhook is still accepted", async () => {
    process.env.NODE_ENV = "production";
    process.env.ADMIN_API_TOKEN = "expected-admin-token";
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const app = await buildApp();
    const bodyJson = JSON.stringify(githubWebhookPayload);
    const signature = computeWebhookSignature(bodyJson, "webhook-secret");

    await request(app.getHttpServer())
      .post("/webhooks/github")
      .set("x-github-event", "push")
      .set("x-hub-signature-256", signature)
      .set("Content-Type", "application/json")
      .send(bodyJson)
      .expect(202, { accepted: false });

    await app.close();
  });

  it("GIVEN configured DASHBOARD_ORIGIN WHEN CORS preflight runs THEN it returns the configured origin", async () => {
    process.env.NODE_ENV = "production";
    process.env.ADMIN_API_TOKEN = "expected-admin-token";
    process.env.DASHBOARD_ORIGIN = "https://dashboard.example.com";

    const app = await buildApp();

    await request(app.getHttpServer())
      .options("/repos")
      .set("Origin", "https://dashboard.example.com")
      .set("Access-Control-Request-Method", "GET")
      .expect(204)
      .expect("access-control-allow-origin", "https://dashboard.example.com");

    await app.close();
  });
});
