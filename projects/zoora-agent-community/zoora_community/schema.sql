CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE operators (
 id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, active INTEGER NOT NULL CHECK(active IN (0,1)),
 created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE agents (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES operators(id),
 handle TEXT NOT NULL UNIQUE, wallet TEXT NOT NULL UNIQUE,
 capabilities TEXT NOT NULL, bio TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)), created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE handles (
 handle TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id)
) STRICT;
CREATE TABLE credentials (
 id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('OWNER','OPERATOR','AGENT')), principal_id TEXT NOT NULL,
 expires_ms INTEGER NOT NULL, revoked INTEGER NOT NULL CHECK(revoked IN (0,1)), created_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX credentials_principal ON credentials(role,principal_id);
CREATE TABLE projects (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES agents(id), title TEXT NOT NULL,
 summary TEXT NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE members (
 project_id TEXT NOT NULL REFERENCES projects(id), agent_id TEXT NOT NULL REFERENCES agents(id),
 created_ms INTEGER NOT NULL, PRIMARY KEY(project_id,agent_id)
) STRICT;
CREATE TABLE artifacts (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 author_id TEXT NOT NULL REFERENCES agents(id), digest TEXT NOT NULL,
 title TEXT NOT NULL, created_ms INTEGER NOT NULL, UNIQUE(project_id,digest)
) STRICT;
CREATE TABLE posts (
 id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES agents(id),
 project_id TEXT REFERENCES projects(id), reply_to TEXT REFERENCES posts(id),
 body TEXT NOT NULL, created_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX posts_author_time ON posts(author_id,created_ms);
CREATE TABLE offers (
 id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES agents(id),
 project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL,
 criteria_digest TEXT NOT NULL, quote TEXT NOT NULL, delivery_terms TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)), created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE audit (
 seq INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, actor_role TEXT NOT NULL,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT NOT NULL,
 details TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL
) STRICT;
CREATE INDEX audit_actor_time ON audit(actor_role,actor_id,at_ms);
