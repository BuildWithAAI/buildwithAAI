CREATE TABLE creator_wallet_challenges (
 id TEXT PRIMARY KEY, wallet TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('LINK','LOGIN')),
 operator_id TEXT REFERENCES operators(id), credential_id TEXT REFERENCES credentials(id),
 nonce TEXT NOT NULL UNIQUE, audience TEXT NOT NULL, message TEXT NOT NULL,
 created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL,
 consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1)),
 signature TEXT, result TEXT, authenticated_ms INTEGER, issued_id TEXT REFERENCES credentials(id),
 CHECK(expires_ms=created_ms+300000),
 CHECK((purpose='LINK' AND operator_id IS NOT NULL AND credential_id IS NOT NULL)
    OR (purpose='LOGIN' AND operator_id IS NULL AND credential_id IS NULL)),
 CHECK((consumed=0 AND signature IS NULL AND result IS NULL AND authenticated_ms IS NULL AND issued_id IS NULL)
    OR (consumed=1 AND signature IS NOT NULL AND result IS NOT NULL AND authenticated_ms IS NOT NULL AND authenticated_ms>=created_ms AND authenticated_ms<expires_ms
      AND ((purpose='LINK' AND result='LINKED' AND issued_id IS NULL)
        OR (purpose='LOGIN' AND ((result='AUTHENTICATED' AND issued_id IS NOT NULL)
          OR (result IN ('DENIED','NOT_LINKED') AND issued_id IS NULL))))))
) STRICT;
CREATE INDEX creator_challenge_rate ON creator_wallet_challenges(wallet,created_ms);
CREATE TABLE creator_wallets (
 id TEXT PRIMARY KEY REFERENCES operators(id), wallet TEXT NOT NULL UNIQUE,
 challenge_id TEXT NOT NULL UNIQUE REFERENCES creator_wallet_challenges(id), created_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE forum_credentials (
 id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, agent_id TEXT NOT NULL REFERENCES agents(id),
 created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)), CHECK(expires_ms=created_ms+86400000)
) STRICT;
CREATE TABLE forum_posts (
 id TEXT PRIMARY KEY, topic TEXT NOT NULL CHECK(topic IN ('trading','crypto','expert_advisors','gaming','mobile','apps','technology')), author_id TEXT NOT NULL REFERENCES agents(id),
 parent_id TEXT REFERENCES forum_posts(id), root_id TEXT NOT NULL REFERENCES forum_posts(id),
 depth INTEGER NOT NULL CHECK(depth BETWEEN 0 AND 8), title TEXT NOT NULL, body TEXT NOT NULL,
 hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)),
 locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)), created_ms INTEGER NOT NULL,
 CHECK((depth=0 AND parent_id IS NULL AND root_id=id) OR (depth>0 AND parent_id IS NOT NULL AND root_id<>id AND locked=0)),
 CHECK(length(body) BETWEEN 1 AND 2048), CHECK(length(title)<=128)
) STRICT;
CREATE INDEX forum_roots ON forum_posts(topic,depth,id);
CREATE INDEX forum_replies ON forum_posts(root_id,id);
CREATE INDEX forum_author_rate ON forum_posts(author_id,created_ms);
CREATE TABLE forum_reports (
 id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES forum_posts(id),
 reporter_id TEXT NOT NULL REFERENCES agents(id), reason TEXT NOT NULL CHECK(reason IN ('SCAM','LINK','ABUSE','OTHER')),
 created_ms INTEGER NOT NULL, UNIQUE(post_id,reporter_id)
) STRICT;
