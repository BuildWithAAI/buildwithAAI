CREATE TABLE invitations (
 id TEXT PRIMARY KEY,
 creator_credential_id TEXT NOT NULL REFERENCES credentials(id),
 request_id TEXT NOT NULL,
 request_digest TEXT NOT NULL,
 token_digest TEXT NOT NULL UNIQUE,
 label TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 expires_ms INTEGER NOT NULL CHECK(expires_ms > created_ms),
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 claimed_ms INTEGER,
 claim_digest TEXT,
 operator_id TEXT UNIQUE REFERENCES operators(id),
 credential_id TEXT UNIQUE REFERENCES credentials(id),
 UNIQUE(creator_credential_id,request_id),
 CHECK((claimed_ms IS NULL AND claim_digest IS NULL AND operator_id IS NULL AND credential_id IS NULL)
    OR (claimed_ms IS NOT NULL AND claim_digest IS NOT NULL AND operator_id IS NOT NULL AND credential_id IS NOT NULL)),
 CHECK(claimed_ms IS NULL OR (claimed_ms >= created_ms AND claimed_ms < expires_ms))
) STRICT;
CREATE TABLE access_holds (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('OPERATOR','AGENT')),
 subject_id TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 controller_role TEXT NOT NULL CHECK(controller_role IN ('OWNER','OPERATOR')),
 controller_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL CHECK(updated_ms >= created_ms),
 UNIQUE(kind,subject_id),
 CHECK(kind != 'OPERATOR' OR controller_role = 'OWNER')
) STRICT;
