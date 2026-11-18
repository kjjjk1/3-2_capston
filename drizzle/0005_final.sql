CREATE TABLE analysis_runs (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), created_at INTEGER NOT NULL,
 status TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT, confirmed_id TEXT
);
CREATE INDEX runs_room ON analysis_runs(room_id,created_at);
CREATE TABLE analysis_locks(room_id TEXT PRIMARY KEY,started_at INTEGER NOT NULL);
CREATE TABLE api_usage(day TEXT PRIMARY KEY,calls INTEGER NOT NULL DEFAULT 0);
CREATE TABLE meeting_history (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), run_id TEXT NOT NULL UNIQUE,
 venue TEXT NOT NULL, regular INTEGER NOT NULL, created_at TEXT NOT NULL, candidate_id TEXT NOT NULL
);
CREATE TABLE burden_records (
 meeting_id TEXT NOT NULL REFERENCES meeting_history(id), member_id TEXT NOT NULL,
 name TEXT NOT NULL, minutes REAL NOT NULL, walk REAL NOT NULL, transfers INTEGER NOT NULL,
 relative REAL NOT NULL, PRIMARY KEY(meeting_id,member_id)
);
