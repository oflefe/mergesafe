# mergesafe

MergeSafe — evidence-based verification for agent-generated pull requests.

## What this repository contains

- `apps/api`: a NestJS API that ingests GitHub pull request webhooks, scores risk, evaluates repo policy, suggests tests, stores verification state, posts a single verification comment, and creates the `Agentic PR Verification` check run.
- `apps/web`: a Next.js dashboard that lists repositories, pull requests, and verification details.
- `apps/api/db/migrations/001_initial.sql`: the PostgreSQL schema for repositories, pull requests, changed files, risk findings, verification requirements, check snapshots, external review findings, repo policies, and verification runs.
- `.agent-pr-verifier.yml`: default repo policy and weighting configuration.

## Local commands

```bash
npm install
npm run db:migrate -w @mergesafe/api
npm test
npm run build
npm run start:api
```

The API uses inline execution by default for local development and switches to BullMQ + Redis automatically when `REDIS_URL` is configured.

## GitHub App inputs

Set the values in `.env.example` to enable live GitHub App comment/check creation:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `REDIS_URL`
- `DATABASE_URL`

## Database migrations

Apply SQL migrations for the API database:

```bash
npm run db:migrate -w @mergesafe/api
```

`DATABASE_URL` defaults to `postgres://postgres:postgres@localhost:5432/mergesafe` when unset.
