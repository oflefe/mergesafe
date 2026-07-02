import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { GitHubAppClient } from '../../src/github/github.client';
import { VerificationRepository } from '../../src/storage/verification.repository';

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

describe('GitHubWebhookController', () => {
  it('accepts pull_request webhooks and posts exactly one verification comment', async () => {
    const fakeGitHubClient = new FakeGitHubClient();
    process.env.GITHUB_WEBHOOK_SECRET = '';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GitHubAppClient)
      .useValue(fakeGitHubClient)
      .compile();

    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const payload = {
      action: 'opened',
      repository: {
        owner: { login: 'octo' },
        name: 'demo',
        full_name: 'octo/demo',
      },
      pull_request: {
        number: 7,
        id: 700,
        title: 'Auth hardening',
        body: 'This PR updates auth checks.',
        head: { ref: 'copilot/auth-hardening' },
        user: { login: 'copilot-swe-agent[bot]' },
      },
      commits: [{ sha: 'abc123', message: 'generated auth update by copilot' }],
      changed_files: [
        { filename: 'src/auth/session.service.ts', additions: 20, deletions: 5 },
      ],
      check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
      review_comments: [],
      repository_scripts: {
        test: 'jest',
        'test:unit': 'jest unit',
        'test:integration': 'jest integration',
      },
      repository_files: {
        'src/auth/session.service.ts': 'export const session = () => true;',
      },
    };

    await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('x-github-event', 'pull_request')
      .send(payload)
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

    await request(app.getHttpServer())
      .get('/prs/octo%2Fdemo%237/verification')
      .expect(200);

    await app.close();
  });
});
