CREATE TABLE commerce_books (
 id TEXT PRIMARY KEY,
 operator_id TEXT NOT NULL REFERENCES operators(id),
 credential_id TEXT NOT NULL REFERENCES credentials(id),
 request_id TEXT NOT NULL,
 request_sha256 TEXT NOT NULL,
 policy_json TEXT NOT NULL,
 bindings_json TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL CHECK(updated_ms >= created_ms),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 256),
 state_sha256 TEXT NOT NULL,
 UNIQUE(operator_id,request_id)
) STRICT;
CREATE TABLE commerce_actions (
 id TEXT PRIMARY KEY,
 book_id TEXT NOT NULL REFERENCES commerce_books(id),
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 256),
 request_id TEXT NOT NULL,
 request_sha256 TEXT NOT NULL,
 actor_role TEXT NOT NULL CHECK(actor_role IN ('OWNER','OPERATOR','AGENT')),
 actor_id TEXT NOT NULL,
 credential_id TEXT NOT NULL REFERENCES credentials(id),
 request_json TEXT NOT NULL,
 action_json TEXT NOT NULL,
 outcome TEXT NOT NULL,
 state_sha256 TEXT NOT NULL,
 at_ms INTEGER NOT NULL,
 UNIQUE(book_id,sequence),
 UNIQUE(book_id,request_id)
) STRICT;
