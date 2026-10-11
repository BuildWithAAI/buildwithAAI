CREATE TABLE wallet_challenges (
 id TEXT PRIMARY KEY, actor_role TEXT NOT NULL CHECK(actor_role IN ('OPERATOR','AGENT')),
 actor_id TEXT NOT NULL, credential_id TEXT NOT NULL REFERENCES credentials(id),
 operator_id TEXT NOT NULL REFERENCES operators(id), agent_id TEXT REFERENCES agents(id),
 profile TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE, message TEXT NOT NULL,
 created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL,
 consumed INTEGER NOT NULL CHECK(consumed IN (0,1))
) STRICT;
CREATE INDEX challenges_actor_time ON wallet_challenges(actor_role,actor_id,created_ms);
CREATE TABLE wallet_proofs (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id),
 challenge_id TEXT NOT NULL UNIQUE REFERENCES wallet_challenges(id),
 signature TEXT NOT NULL, verified_ms INTEGER NOT NULL, digest TEXT NOT NULL, seq INTEGER NOT NULL UNIQUE
) STRICT;
CREATE INDEX proofs_agent_time ON wallet_proofs(agent_id,verified_ms);
CREATE TABLE transactions (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id),
 network TEXT NOT NULL CHECK(network IN ('solana:devnet','solana:mainnet')),
 signature TEXT NOT NULL, created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('AVAILABLE','UNAVAILABLE','FAILED','UNVERIFIED')),
 report TEXT NOT NULL, raw_rpc TEXT
) STRICT;
CREATE INDEX transactions_agent_time ON transactions(agent_id,created_ms);
