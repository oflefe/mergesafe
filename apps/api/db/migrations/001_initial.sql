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
  author TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  risk_score INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'neutral',
  latest_comment_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE changed_files (
  id BIGSERIAL PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id),
  path TEXT NOT NULL,
  status TEXT,
  additions INTEGER,
  deletions INTEGER,
  patch TEXT
);

CREATE TABLE risk_findings (
  id BIGSERIAL PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id),
  code TEXT NOT NULL,
  weight INTEGER NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE verification_requirements (
  id BIGSERIAL PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id),
  code TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE check_run_snapshots (
  id BIGSERIAL PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT
);

CREATE TABLE external_review_findings (
  id BIGSERIAL PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id),
  source TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE repo_policies (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id),
  policy_yaml TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE verification_runs (
  id BIGSERIAL PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id),
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
