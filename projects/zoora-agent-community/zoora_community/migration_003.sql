CREATE TABLE jobs (
 id TEXT PRIMARY KEY,
 agent_id TEXT NOT NULL REFERENCES agents(id),
 credential_id TEXT NOT NULL REFERENCES credentials(id),
 request_id TEXT NOT NULL,
 request_digest TEXT NOT NULL,
 title TEXT NOT NULL,
 prompt TEXT NOT NULL,
 project_id TEXT REFERENCES projects(id),
 max_steps INTEGER NOT NULL CHECK(max_steps BETWEEN 1 AND 6),
 timeout_seconds INTEGER NOT NULL CHECK(timeout_seconds BETWEEN 1 AND 120),
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL,
 expires_ms INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED','EXPIRED')),
 stop_requested INTEGER NOT NULL DEFAULT 0 CHECK(stop_requested IN (0,1)),
 attempt_id TEXT,
 claim_digest TEXT,
 lease_expires_ms INTEGER,
 run_max_steps INTEGER CHECK(run_max_steps BETWEEN 1 AND 6),
 run_timeout_seconds INTEGER CHECK(run_timeout_seconds BETWEEN 1 AND 120),
 report_sha256 TEXT,
 report_bytes INTEGER CHECK(report_bytes BETWEEN 1 AND 131072),
 steps INTEGER CHECK(steps BETWEEN 0 AND 6),
 error_code TEXT,
 artifact_id TEXT REFERENCES artifacts(id),
 completion_digest TEXT,
 UNIQUE(agent_id,request_id),
 CHECK(updated_ms >= created_ms AND expires_ms > created_ms),
 CHECK((attempt_id IS NULL AND claim_digest IS NULL AND lease_expires_ms IS NULL AND run_max_steps IS NULL AND run_timeout_seconds IS NULL)
    OR (attempt_id IS NOT NULL AND claim_digest IS NOT NULL AND lease_expires_ms IS NOT NULL AND run_max_steps IS NOT NULL AND run_timeout_seconds IS NOT NULL)),
 CHECK((report_sha256 IS NULL AND report_bytes IS NULL AND steps IS NULL)
    OR (report_sha256 IS NOT NULL AND report_bytes IS NOT NULL AND steps IS NOT NULL)),
 CHECK(state NOT IN ('RUNNING','SUCCEEDED','FAILED','INTERRUPTED') OR attempt_id IS NOT NULL),
 CHECK(state NOT IN ('QUEUED','EXPIRED') OR attempt_id IS NULL),
 CHECK(state != 'SUCCEEDED' OR (report_sha256 IS NOT NULL AND error_code IS NULL AND completion_digest IS NOT NULL)),
 CHECK(state != 'FAILED' OR (error_code IS NOT NULL AND completion_digest IS NOT NULL)),
 CHECK(artifact_id IS NULL OR state = 'SUCCEEDED')
) STRICT;
CREATE INDEX jobs_queue ON jobs(state,created_ms,id);
CREATE INDEX jobs_agent ON jobs(agent_id,id);
CREATE INDEX audit_resource_action ON audit(resource_id,action);
