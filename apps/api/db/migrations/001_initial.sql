CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id),
  pull_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_branch TEXT NOT NULL DEFAULT 'main',
  head_sha TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open',
  installation_id BIGINT,
  github_pull_request_id BIGINT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'neutral',
  latest_comment_id BIGINT,
  latest_check_run_id BIGINT,
  latest_verification_run_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE verification_runs (
  id BIGSERIAL PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id),
  request_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE changed_files (
  id BIGSERIAL PRIMARY KEY,
  verification_run_id BIGINT NOT NULL REFERENCES verification_runs(id),
  path TEXT NOT NULL,
  status TEXT,
  additions INTEGER,
  deletions INTEGER,
  patch TEXT
);

CREATE TABLE risk_findings (
  id BIGSERIAL PRIMARY KEY,
  verification_run_id BIGINT NOT NULL REFERENCES verification_runs(id),
  code TEXT NOT NULL,
  weight INTEGER NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE verification_requirements (
  id BIGSERIAL PRIMARY KEY,
  verification_run_id BIGINT NOT NULL REFERENCES verification_runs(id),
  code TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE check_run_snapshots (
  id BIGSERIAL PRIMARY KEY,
  verification_run_id BIGINT NOT NULL REFERENCES verification_runs(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT
);

CREATE TABLE external_review_findings (
  id BIGSERIAL PRIMARY KEY,
  verification_run_id BIGINT NOT NULL REFERENCES verification_runs(id),
  source TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE repo_policies (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
  policy_yaml TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX pull_requests_repository_updated_idx ON pull_requests(repository_id, updated_at DESC);
CREATE INDEX verification_runs_pull_request_idx ON verification_runs(pull_request_id, created_at DESC);
CREATE INDEX changed_files_run_idx ON changed_files(verification_run_id);
CREATE INDEX risk_findings_run_idx ON risk_findings(verification_run_id);
CREATE INDEX verification_requirements_run_idx ON verification_requirements(verification_run_id);
CREATE INDEX check_run_snapshots_run_idx ON check_run_snapshots(verification_run_id);
CREATE INDEX external_review_findings_run_idx ON external_review_findings(verification_run_id);
