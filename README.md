# MergeSafe

MergeSafe is an evidence-based PR verification gate for agent-generated pull requests.
It ingests GitHub `pull_request` events, computes risk from changed files and commit context, evaluates policy rules, summarizes external AI-review findings, and generates a verification result.

This guide is written for someone with zero prior context on this repository.

## What You Get

- API service that receives webhook/recheck requests and computes verification.
- Web dashboard that lists repositories, PRs, and verification outcomes.
- Local Postgres + Redis via Docker Compose.

## Prerequisites

- Node.js 22+
- npm 10+
- Docker + Docker Compose

Check versions:

```bash
node -v
npm -v
docker --version
docker compose version
```

## Quick Start (Local-Only, No GitHub App)

This path is the fastest way to run MergeSafe locally.

1. Clone and install dependencies.

```bash
git clone <this-repo-url>
cd mergesafe
npm ci
```

2. Create your env file.

```bash
cp .env.example .env
```

3. Put these values into `.env`.

```env
PORT=3001
NODE_ENV=development

# Local Docker DB/Redis in this repo use host ports 5433 and 6377.
POSTGRES_PASSWORD=postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5433/mergesafe
REDIS_URL=redis://localhost:6377

DASHBOARD_ORIGIN=http://localhost:3000
ADMIN_API_TOKEN=local-dev-admin-token
DASHBOARD_API_TOKEN=local-dev-dashboard-token

# Local-only testing without webhook signature:
GITHUB_WEBHOOK_SECRET=

# Optional but recommended for real evidence fetch from GitHub:
GITHUB_TOKEN=

# Not required for local-only mode:
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
```

4. Start infrastructure and migrate DB.

```bash
docker compose up -d postgres redis
npm run db:migrate
```

5. Start API and Web in separate terminals.

Terminal 1:

```bash
npm run start:api
```

Terminal 2:

```bash
npm run start:web
```

6. Open the dashboard.

- http://localhost:3000

## Where To Obtain Each Env Var

### Values You Choose Yourself (local defaults are fine)

- `PORT`: API listen port, usually `3001`.
- `NODE_ENV`: use `development` locally.
- `POSTGRES_PASSWORD`: choose any local password.
- `ADMIN_API_TOKEN`: choose any random token for protected routes in production.
- `DASHBOARD_API_TOKEN`: choose any random token; for local you can reuse admin token.

### Values Derived From Local Docker Setup

- `DATABASE_URL`: built from your DB user/password/host/port/db name.
  - This repo defaults to `postgres://postgres:<POSTGRES_PASSWORD>@localhost:5433/mergesafe`.
- `REDIS_URL`: built from host/port.
  - This repo defaults to `redis://localhost:6377`.
- `DASHBOARD_ORIGIN`: where web UI runs, usually `http://localhost:3000`.

### Values From GitHub (Optional Local, Required For Full GitHub Integration)

- `GITHUB_TOKEN`:
  - Source: GitHub user settings -> Developer settings -> Personal access tokens.
  - Use a fine-grained token with repository read access for target repos.
- `GITHUB_APP_ID`:
  - Source: GitHub App settings -> General -> App ID.
- `GITHUB_PRIVATE_KEY`:
  - Source: GitHub App settings -> Private keys -> Generate private key.
  - Put the PEM content in `.env` (with `\n` newlines if single-line format).
- `GITHUB_WEBHOOK_SECRET`:
  - Source: GitHub App settings -> Webhook -> Secret.
  - Must match signature used in incoming webhook requests.

## First Verification Run (Without GitHub App)

Use this to confirm API, DB, and UI wiring works.

1. Optional: set `GITHUB_TOKEN` in `.env` for richer evidence fetching.
2. Send a synthetic webhook payload.

```bash
payload='{"action":"synchronize","repository":{"name":"vibe-sec","full_name":"oflefe/vibe-sec","owner":{"login":"oflefe"}},"pull_request":{"number":1,"id":3989949978,"title":"[codex] build vibe app security scanner","body":"manual local trigger","user":{"login":"oflefe"},"head":{"ref":"codex/vibe-app-security-scanner","sha":"b587282c1367465cae9c10c91aa30efc8044e8b4"},"base":{"ref":"main"}}}'

curl -X POST http://localhost:3001/webhooks/github \
  -H "x-github-event: pull_request" \
  -H "content-type: application/json" \
  -d "$payload"
```

3. Verify data landed.

```bash
curl http://localhost:3001/repos
curl http://localhost:3001/repos/oflefe%2Fvibe-sec/prs
curl http://localhost:3001/prs/oflefe%2Fvibe-sec%231/verification
```

4. Check in UI.

- http://localhost:3000
- open repository `oflefe/vibe-sec`
- open PR `oflefe/vibe-sec#1`

## Verify Any PR From Any Repo (Local, With GitHub Token)

This flow lets you point MergeSafe at any pull request in any public or accessible private repo and get a full verification result. It uses a GitHub Personal Access Token for evidence fetching — no GitHub App or installation required.

### How It Works

- `GITHUB_TOKEN` is checked first by the evidence fetcher, bypassing the GitHub App installation token flow entirely.
- Webhook signature verification is skipped when `GITHUB_WEBHOOK_SECRET` is empty and `NODE_ENV` is not `production`.
- Without `REDIS_URL`, the queue runs inline — verification executes synchronously within the HTTP request.
- Without an `installationId` in the payload, the GitHub client logs and returns mock IDs instead of posting comments/check runs to GitHub. The verification result is still computed and persisted locally.

### Prerequisites

- API running locally (see Quick Start above).
- `GITHUB_TOKEN` set in `.env` with read access to the target repo.
- `jq` and `curl` installed.

### Steps

1. Export your token and target PR coordinates.

```bash
export GITHUB_TOKEN=ghp_your_token_here
OWNER=Medsien
REPO=medsien-api
PR_NUMBER=2787
```

2. Fetch real PR metadata from GitHub (needed for the head SHA so CI evidence is pulled correctly).

```bash
PR_DATA=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/pulls/$PR_NUMBER")

HEAD_SHA=$(echo "$PR_DATA" | jq -r .head.sha)
HEAD_REF=$(echo "$PR_DATA" | jq -r .head.ref)
BASE_REF=$(echo "$PR_DATA" | jq -r .base.ref)
PR_TITLE=$(echo "$PR_DATA" | jq -r .title)
PR_BODY=$(echo "$PR_DATA" | jq -r .body)
PR_USER=$(echo "$PR_DATA" | jq -r .user.login)
PR_ID=$(echo "$PR_DATA" | jq -r .id)
```

3. Send a simulated webhook payload to the local endpoint.

```bash
curl -s -X POST http://localhost:3001/webhooks/github \
  -H "Content-Type: application/json" \
  -H "x-github-event: pull_request" \
  -d "{
    \"action\": \"opened\",
    \"pull_request\": {
      \"number\": $PR_NUMBER,
      \"id\": $PR_ID,
      \"title\": $(echo "$PR_TITLE" | jq -Rs .),
      \"body\": $(echo "$PR_BODY" | jq -Rs .),
      \"user\": { \"login\": $(echo "$PR_USER" | jq -Rs .) },
      \"head\": { \"ref\": $(echo "$HEAD_REF" | jq -Rs .), \"sha\": \"$HEAD_SHA\" },
      \"base\": { \"ref\": $(echo "$BASE_REF" | jq -Rs .) }
    },
    \"repository\": {
      \"owner\": { \"login\": \"$OWNER\" },
      \"name\": \"$REPO\",
      \"full_name\": \"$OWNER/$REPO\"
    }
  }"
```

4. The endpoint returns `202` with:

```json
{ "accepted": true, "pullRequest": "Medsien/medsien-api#2787" }
```

5. Inspect the result via API or dashboard.

```bash
# List repos
curl http://localhost:3001/repos

# List PRs for the repo
curl "http://localhost:3001/repos/$OWNER%2F$REPO/prs"

# Get verification result
curl "http://localhost:3001/prs/$OWNER%2F$REPO%23$PR_NUMBER/verification"
```

Or open the dashboard at http://localhost:3000 and navigate to the repository and PR.

### Notes

- The `action` field accepts `opened`, `synchronize`, or `reopened`. Use `opened` for a fresh verification.
- If the PR has no CI check runs on the head SHA, the evidence fetcher will still return other evidence (commits, changed files, review comments, repo context).
- The verification result includes risk score, verdict (`PASS` / `NEEDS_REVIEW` / `FAIL`), CI summary, test impact analysis, and policy evaluation.
- No comment or check run is written back to GitHub in this mode — results are local only.

## Full GitHub App Mode (Comment + Check Run Write-Back)

Use this mode when you want MergeSafe to post/update PR comments and check runs on GitHub.

1. Create a GitHub App.
2. Set permissions:
   - Metadata: Read-only
   - Pull requests: Read-only
   - Contents: Read-only
   - Issues: Read and write
   - Checks: Read and write
3. Subscribe to `pull_request` webhook events.
4. Install the app on your target repository.
5. Configure env vars:
   - `GITHUB_APP_ID`
   - `GITHUB_PRIVATE_KEY`
   - `GITHUB_WEBHOOK_SECRET`
6. Expose local API with a tunnel and set webhook URL:
   - `https://<your-tunnel-domain>/webhooks/github`

## Troubleshooting

### `EADDRINUSE` on start

Ports already in use. Free them:

```bash
fuser -k 3000/tcp || true
fuser -k 3001/tcp || true
```

### `password authentication failed for user "postgres"`

`POSTGRES_PASSWORD` and `DATABASE_URL` password do not match. Ensure both use the same value.

### `Missing webhook signature`

You set `GITHUB_WEBHOOK_SECRET` but did not send `x-hub-signature-256`.

For local unsigned testing, set:

```env
GITHUB_WEBHOOK_SECRET=
```

Then restart API.

### UI shows empty while API has data

Hard refresh browser, then open:

- http://localhost:3000/repos/oflefe%2Fvibe-sec
- http://localhost:3000/prs/oflefe%2Fvibe-sec%231

## Useful Commands

```bash
# lint + typecheck + tests + build
npm run lint
npm run typecheck
npm run test
npm run build

# db migrate
npm run db:migrate

# run API
npm run start:api

# run Web
npm run start:web
```
