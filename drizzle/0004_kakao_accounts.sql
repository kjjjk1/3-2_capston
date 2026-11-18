CREATE TABLE app_users(id TEXT PRIMARY KEY,kakao_id TEXT NOT NULL UNIQUE,nickname TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE oauth_states(state_hash TEXT PRIMARY KEY,return_to TEXT NOT NULL,expires_at INTEGER NOT NULL);
ALTER TABLE room_members ADD COLUMN user_id TEXT REFERENCES app_users(id);
ALTER TABLE rooms ADD COLUMN creator_user_id TEXT REFERENCES app_users(id);
CREATE UNIQUE INDEX room_account_unique ON room_members(room_id,user_id) WHERE user_id IS NOT NULL;
