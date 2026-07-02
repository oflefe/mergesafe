import { createHmac } from 'node:crypto';
import { PullRequestEvidence } from '../../src/github/github-evidence-fetcher';

export const githubWebhookPayload = {
  action: 'opened',
  installation: { id: 42 },
  pull_request: {
    number: 7,
    id: 700,
    title: 'Auth hardening',
    body: 'This PR updates auth checks.',
    user: { login: 'copilot-swe-agent[bot]' },
    head: { ref: 'copilot/auth-hardening', sha: 'abc123def456' },
    base: { ref: 'main' },
  },
  repository: {
    owner: { login: 'octo' },
    name: 'demo',
    full_name: 'octo/demo',
  },
};

export const fetchedEvidence: PullRequestEvidence = {
  commits: [{ sha: 'abc123def456', message: 'feat: add auth hardening' }],
  changedFiles: [{ path: 'src/auth/session.service.ts', status: 'modified', additions: 20, deletions: 5 }],
  checkRuns: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
  reviewComments: [],
  repositoryFiles: { 'src/auth/session.service.ts': 'export const session = () => true;' },
  repositoryScripts: {
    test: 'jest',
    'test:unit': 'jest unit',
    'test:integration': 'jest integration',
  },
  policyText: undefined,
};

export function computeWebhookSignature(rawBody: Buffer | string, secret: string): string {
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
