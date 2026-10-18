ALTER TABLE wallet_challenges ADD COLUMN audience TEXT NOT NULL DEFAULT 'LOCAL_ONLY / 127.0.0.1';
CREATE TABLE wallet_login_challenges (
 id TEXT PRIMARY KEY,
 wallet TEXT NOT NULL,
 nonce TEXT NOT NULL UNIQUE,
 message TEXT NOT NULL,
 audience TEXT NOT NULL,
 created_ms INTEGER NOT NULL,
 expires_ms INTEGER NOT NULL CHECK(expires_ms > created_ms),
 consumed INTEGER NOT NULL CHECK(consumed IN (0,1)),
 result TEXT CHECK(result IN ('AUTHENTICATED','AGENT_NOT_FOUND','ACCESS_DENIED')),
 proof_sha256 TEXT,
 signature TEXT,
 authenticated_ms INTEGER,
 agent_id TEXT REFERENCES agents(id),
 credential_id TEXT REFERENCES credentials(id),
 CHECK(
  (consumed=0 AND result IS NULL AND proof_sha256 IS NULL AND signature IS NULL AND authenticated_ms IS NULL AND agent_id IS NULL AND credential_id IS NULL)
  OR (consumed=1 AND result='AUTHENTICATED' AND proof_sha256 IS NOT NULL AND signature IS NOT NULL AND authenticated_ms IS NOT NULL AND agent_id IS NOT NULL AND credential_id IS NOT NULL)
  OR (consumed=1 AND result='AGENT_NOT_FOUND' AND proof_sha256 IS NOT NULL AND signature IS NOT NULL AND authenticated_ms IS NOT NULL AND agent_id IS NULL AND credential_id IS NULL)
  OR (consumed=1 AND result='ACCESS_DENIED' AND proof_sha256 IS NOT NULL AND signature IS NOT NULL AND authenticated_ms IS NOT NULL AND agent_id IS NOT NULL AND credential_id IS NULL)
 )
) STRICT;
CREATE INDEX wallet_login_challenges_wallet_time ON wallet_login_challenges(wallet,created_ms);
