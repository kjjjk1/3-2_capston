-- Dedicated private application schema; not exposed through Supabase Data API.
CREATE TABLE IF NOT EXISTS app_users(id TEXT PRIMARY KEY,kakao_id TEXT NOT NULL UNIQUE,nickname TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rooms (
 id TEXT PRIMARY KEY NOT NULL,
 title TEXT NOT NULL,
 mode TEXT NOT NULL,
 created_at TEXT NOT NULL
, owner_hash TEXT, photo_key TEXT, owner_member_id TEXT, creator_user_id TEXT REFERENCES app_users(id), roster_creator_hash TEXT);
CREATE TABLE IF NOT EXISTS "room_members" (
 id TEXT PRIMARY KEY NOT NULL,
 room_id TEXT NOT NULL REFERENCES rooms(id),
 token_hash TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 stop_id TEXT NOT NULL,
 slot BIGINT NOT NULL CHECK(slot >= 0), managed BIGINT NOT NULL DEFAULT 0, user_id TEXT REFERENCES app_users(id),
 UNIQUE(room_id,name),
 UNIQUE(room_id,slot)
);
CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states(state_hash TEXT PRIMARY KEY,return_to TEXT NOT NULL,expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS analysis_runs (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), created_at BIGINT NOT NULL,
 status TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT, confirmed_id TEXT
);
CREATE TABLE IF NOT EXISTS analysis_locks(room_id TEXT PRIMARY KEY,started_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS api_usage(day TEXT PRIMARY KEY,calls BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS meeting_history (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), run_id TEXT NOT NULL UNIQUE,
 venue TEXT NOT NULL, regular BIGINT NOT NULL, created_at TEXT NOT NULL, candidate_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS burden_records (
 meeting_id TEXT NOT NULL REFERENCES meeting_history(id), member_id TEXT NOT NULL,
 name TEXT NOT NULL, minutes DOUBLE PRECISION NOT NULL, walk DOUBLE PRECISION NOT NULL, transfers BIGINT NOT NULL,
 relative DOUBLE PRECISION NOT NULL, PRIMARY KEY(meeting_id,member_id)
);
CREATE TABLE IF NOT EXISTS transit_network (
 id BIGINT PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_usage (
 day TEXT NOT NULL, provider TEXT NOT NULL, calls BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY(day,provider)
);
CREATE TABLE IF NOT EXISTS access_recovery (
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 subject_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('member','owner')),
 code_hash TEXT NOT NULL UNIQUE,
 expires_at BIGINT NOT NULL,
 PRIMARY KEY(room_id,subject_id,role)
);
CREATE INDEX IF NOT EXISTS room_members_room ON room_members(room_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS room_account_unique ON room_members(room_id,user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS runs_room ON analysis_runs(room_id,created_at);
CREATE TABLE IF NOT EXISTS photo_objects (key TEXT PRIMARY KEY, body BYTEA NOT NULL);
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE burden_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE transit_network ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_recovery ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_objects ENABLE ROW LEVEL SECURITY;
