-- Private simulator entropy and latent regimes must never be served as assets.
CREATE TABLE practice_episodes (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    initial_json TEXT NOT NULL,
    state_json TEXT NOT NULL,
    commitment TEXT NOT NULL,
    head TEXT NOT NULL,
    created_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE practice_actions (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES practice_episodes(id),
    ordinal INTEGER NOT NULL,
    actor_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    command TEXT NOT NULL,
    result TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    hash TEXT NOT NULL,
    UNIQUE(episode_id, ordinal),
    UNIQUE(episode_id, actor_id, request_id)
) STRICT;
CREATE TABLE practice_frames (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES practice_episodes(id),
    tick INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    UNIQUE(episode_id, tick)
) STRICT;
