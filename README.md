# MergeSafe

MergeSafe is an evidence-based PR verification gate for agent-generated pull requests.
It ingests GitHub pull_request events, computes risk from changed files and commit context, evaluates policy rules, summarizes external AI-review findings, and posts one upserted verification comment plus a check run.

## What MergeSafe is

- A deterministic policy and risk engine for PRs.
- A verifier that turns PR evidence into PASS, NEEDS_REVIEW, or FAIL.
- A webhook-driven API plus a small dashboard for viewing repository and PR verification state.
- A system that prefers actionable outputs: required steps, missing tests, and suggested test commands.

## What MergeSafe is not

- Not a replacement for human code review.
- Not a static analyzer or SAST product.
- Not a merge bot.
- Not a full CI system.
- Not a guarantee that code is safe, correct, or compliant.

## Repository layout

- apps/api: NestJS API for webhook ingestion, verification, persistence, and GitHub API write-back.
- apps/web: Next.js dashboard for repos and PR verification state.
- apps/api/db/migrations/001_initial.sql: initial PostgreSQL schema.
- .agent-pr-verifier.yml: repository policy file consumed by verification.

## Local setup

Prerequisites:

- Node.js 22+
- npm 10+
- Docker (for local Postgres and Redis)

Setup:

```bash
cp .env.example .env
docker compose up -d postgres redis
npm ci
npm run db:migrate -w @mergesafe/api
```

Run locally:

```bash
npm run start:api
npm run build:web
```

Notes:

- API default port is 3001.
- Web dashboard default origin is http://localhost:3000.
- Queue execution is inline when REDIS_URL is unset, BullMQ when REDIS_URL is set.

## GitHub App setup

1. Create a GitHub App in your organization or personal account.
2. Enable webhook delivery.
3. Subscribe to pull_request events.
4. Install the app on target repositories.
5. Copy the App ID and generate a private key.
6. Set environment variables in your runtime environment.

### Required permissions

Repository permissions:

- Metadata: Read-only
- Pull requests: Read-only
- Contents: Read-only
- Issues: Read and write
- Checks: Read and write

Events:

- Pull request

## Webhook URL setup

Set your GitHub App webhook URL to:

- https://<your-api-domain>/webhooks/github

If testing locally with a tunnel:

- https://<your-tunnel-domain>/webhooks/github

Set the same webhook secret value in GitHub App settings and GITHUB_WEBHOOK_SECRET.

## Environment variables

Core runtime:

- PORT: API port (default 3001)
- NODE_ENV: development or production
- DATABASE_URL: PostgreSQL connection string
- REDIS_URL: Redis connection string

Security and web:

- DASHBOARD_ORIGIN: allowed CORS origin for dashboard
- ADMIN_API_TOKEN: required in production for non-webhook API routes

GitHub App:

- GITHUB_APP_ID
- GITHUB_PRIVATE_KEY
- GITHUB_WEBHOOK_SECRET

Optional behavior flags:

- GITHUB_TOKEN: fallback for GitHub evidence reads in local/test contexts
- MERGESAFE_POLICY_REF: branch/ref used for policy file fetch
- MERGESAFE_ALLOW_EMPTY_EVIDENCE: allow empty evidence in fail-open scenarios

## Database migration command

```bash
npm run db:migrate -w @mergesafe/api
```

## Running tests

From a clean checkout:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

Single command:

```bash
npm test
```

## Local webhook testing

1. Start API locally.
2. Expose local port 3001 with a tunnel (for example ngrok).
3. Configure GitHub App webhook URL to your tunnel URL + /webhooks/github.
4. Trigger a PR open or synchronize event in a repo where the app is installed.

Manual curl test with signature:

```bash
payload='{"action":"opened","repository":{"name":"demo","owner":{"login":"octo"}},"pull_request":{"number":7,"title":"Auth hardening","body":"Update auth checks","head":{"ref":"copilot/auth-hardening","sha":"abc123def456"},"base":{"ref":"main"},"user":{"login":"copilot-swe-agent[bot]"}}}'
secret='replace-me'
sig=$(printf "%s" "$payload" | openssl dgst -sha256 -hmac "$secret" -binary | xxd -p -c 256)

curl -X POST http://localhost:3001/webhooks/github \
	-H "x-github-event: pull_request" \
	-H "x-hub-signature-256: sha256=$sig" \
	-H "content-type: application/json" \
	-d "$payload"
```

## Deployment steps

1. Provision PostgreSQL and Redis.
2. Set all required environment variables in your deploy platform.
3. Deploy API service from this repository.
4. Run database migration in the deployed environment.
5. Deploy web service.
6. Update GitHub App webhook URL to the deployed API endpoint.
7. Trigger a test PR event and confirm comment + check run creation.

## Smoke test

1. Open a PR that touches low-risk docs-only files.
2. Confirm MergeSafe comment appears and check run is created.
3. Confirm PR appears in dashboard repo and PR detail pages.
4. Open a risky PR (auth or migration changes).
5. Confirm higher risk score and stricter required verification steps.

## Rollback notes

- Keep previous API and web deployment artifacts available.
- If rollout fails, revert to the previous known-good release.
- If a migration introduces incompatibility, restore from database snapshot and redeploy previous release.
- Re-test webhook processing with a known PR payload after rollback.

## Example PR output

```md
<!-- mergesafe-verification -->

## MergeSafe Verification

**Risk score:** 78/100 (HIGH)
**Verdict:** Do not merge until required evidence is added

### Why this PR is risky

- Authentication-sensitive paths changed (+30)
- Migration file changed (+24)
- Agent-authored branch indicator detected (+18)

### Required verification steps

- Add or update integration tests that cover auth/session flows.
- Provide rollback validation for migration changes.
- Request human review for high-risk changes.

### Suggested test commands

- npm run test:integration -w @mergesafe/api

### Missing tests

- Missing integration coverage for src/auth/session.service.ts

### Existing AI-review findings

- [copilot] Null-check missing around decoded token path.

### CI status

- CI requires attention - unit-tests: success, integration-tests: failure
```

## Example policy config

```yaml
version: 1
rules:
	- id: auth-change-needs-integration
		when:
			paths:
				- src/auth/**
				- src/security/**
		require:
			tests:
				- test/integration/**
			review: human
		verdict: fail
		message: Auth or security changes require integration coverage and human review.

	- id: migration-needs-rollback-evidence
		when:
			paths:
				- db/migrations/**
		require:
			changedPaths:
				- docs/rollback/**
			tests:
				- test/integration/**
		verdict: needs_review
		message: Migrations require rollback notes and integration verification evidence.
```

## Short demo script

1. Docs-only PR:
   - Create PR with only docs changes.
   - Show low risk score and PASS or NEEDS_REVIEW output.
2. Risky auth/config/migration PR:
   - Change auth logic, env config, and a migration.
   - Show higher risk score and FAIL/NEEDS_REVIEW with required steps.
3. Add tests and docs:
   - Add integration tests and rollback/docs evidence.
   - Push update to same PR.
4. Recheck and updated verdict:
   - Trigger synchronize event.
   - Show existing comment updated in place and improved verdict.
