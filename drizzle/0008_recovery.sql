CREATE TABLE access_recovery (
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 subject_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('member','owner')),
 code_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 PRIMARY KEY(room_id,subject_id,role)
);
