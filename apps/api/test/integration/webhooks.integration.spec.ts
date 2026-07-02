import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GitHubAppClient } from '../../src/github/github.client';
import { GitHubEvidenceFetcher } from '../../src/github/github-evidence-fetcher';
import { VerificationRepository } from '../../src/storage/verification.repository';
import { githubWebhookPayload, fetchedEvidence, computeWebhookSignature } from '../fixtures/github-webhook.fixture';

class FakeGitHubClient {
  comments: Array<{ body: string; existingCommentId?: number }> = [];
  checks: Array<{ conclusion: string; summary: string }> = [];

  async upsertVerificationComment(_request: any, body: string, existingCommentId?: number) {
    this.comments.push({ body, existingCommentId });
    return existingCommentId ?? 101;
  }

  async createOrUpdateCheckRun(_request: any, result: any) {
    this.checks.push({ conclusion: result.checkConclusion, summary: result.ciSummary });
  }
}

class FakeEvidenceFetcher {
  async fetchPullRequestEvidence() {
    return fetchedEvidence;
  }
}

async function buildApp(fakeGitHubClient: FakeGitHubClient, fakeEvidenceFetcher: FakeEvidenceFetcher) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GitHubAppClient)
    .useValue(fakeGitHubClient)
    .overrideProvider(GitHubEvidenceFetcher)
    .useValue(fakeEvidenceFetcher)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { rawBody: true });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, moduleRef };
}

describe('GitHubWebhookController', () => {
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = '';
  });

  it('ignores unsupported events', async () => {
    const { app } = await buildApp(new FakeGitHubClient(), new FakeEvidenceFetcher());

    await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('x-github-event', 'push')
      .send(githubWebhookPayload)
      .expect(202, { accepted: false });

    await app.close();
  });

  it('ignores unsupported pull_request actions', async () => {
    const { app } = await buildApp(new FakeGitHubClient(), new FakeEvidenceFetcher());

    await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('x-github-event', 'pull_request')
      .send({ ...githubWebhookPayload, action: 'closed' })
      .expect(202, { accepted: false });

    await app.close();
  });

  it('accepts opened, synchronize, and reopened actions', async () => {
    for (const action of ['opened', 'synchronize', 'reopened']) {
      const { app } = await buildApp(new FakeGitHubClient(), new FakeEvidenceFetcher());

      await request(app.getHttpServer())
        .post('/webhooks/github')
        .set('x-github-event', 'pull_request')
        .send({ ...githubWebhookPayload, action })
        .expect(202)
        .expect((res) => {
          expect(res.body.accepted).toBe(true);
        });

      await app.close();
    }
  });

  it('accepts a valid webhook signature', async () => {
    const secret = 'test-secret';
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    const { app } = await buildApp(new FakeGitHubClient(), new FakeEvidenceFetcher());

    const bodyJson = JSON.stringify(githubWebhookPayload);
    const signature = computeWebhookSignature(bodyJson, secret);

    await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('x-github-event', 'pull_request')
      .set('x-hub-signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyJson)
      .expect(202)
      .expect((res) => {
        expect(res.body.accepted).toBe(true);
      });

    await app.close();
  });

  it('rejects an invalid webhook signature', async () => {
    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
    const { app } = await buildApp(new FakeGitHubClient(), new FakeEvidenceFetcher());

    await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('x-github-event', 'pull_request')
      .set('x-hub-signature-256', 'sha256=invalidsignature')
      .send(githubWebhookPayload)
      .expect(401);

    await app.close();
  });

  it('transforms a real GitHub webhook fixture into a complete VerificationRequest', async () => {
    const fakeGitHubClient = new FakeGitHubClient();
    const { app, moduleRef } = await buildApp(fakeGitHubClient, new FakeEvidenceFetcher());

    await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('x-github-event', 'pull_request')
      .send(githubWebhookPayload)
      .expect(202, { accepted: true, pullRequest: 'octo/demo#7' });

    const repository = moduleRef.get(VerificationRepository);
    const saved = repository.getPullRequest('octo/demo#7');

    expect(saved?.lastRequest).toMatchObject({
      repoOwner: 'octo',
      repoName: 'demo',
      repoId: 'octo/demo',
      pullNumber: 7,
      title: 'Auth hardening',
      body: 'This PR updates auth checks.',
      branchName: 'copilot/auth-hardening',
      baseBranch: 'main',
      headSha: 'abc123def456',
      author: 'copilot-swe-agent[bot]',
      action: 'opened',
      installationId: 42,
      commits: fetchedEvidence.commits,
      changedFiles: fetchedEvidence.changedFiles,
      checkRuns: fetchedEvidence.checkRuns,
      reviewComments: fetchedEvidence.reviewComments,
    });

    expect(fakeGitHubClient.comments).toHaveLength(1);
    expect(fakeGitHubClient.checks).toHaveLength(1);
    expect(fakeGitHubClient.comments[0].body).toContain('Agentic PR Verification');
    expect(saved?.latestVerification?.verdict).toBe('fail');

    await app.close();
  });

  it('accepts pull_request webhooks and posts exactly one verification comment', async () => {
    const fakeGitHubClient = new FakeGitHubClient();
    const { app, moduleRef } = await buildApp(fakeGitHubClient, new FakeEvidenceFetcher());

    await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('x-github-event', 'pull_request')
      .send(githubWebhookPayload)
      .expect(202);

    expect(fakeGitHubClient.comments).toHaveLength(1);
    expect(fakeGitHubClient.checks).toHaveLength(1);
    expect(fakeGitHubClient.comments[0].body).toContain('Agentic PR Verification');

    const repository = moduleRef.get(VerificationRepository);
    const saved = repository.getPullRequest('octo/demo#7');
    expect(saved?.latestVerification?.verdict).toBe('fail');

    await request(app.getHttpServer()).get('/repos').expect(200, [
      { id: 'octo/demo', owner: 'octo', name: 'demo' },
    ]);

    await request(app.getHttpServer()).get('/prs/octo%2Fdemo%237/verification').expect(200);

    await app.close();
  });
});
