CREATE TABLE rooms (
 id TEXT PRIMARY KEY NOT NULL,
 title TEXT NOT NULL,
 mode TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE room_members (
 id TEXT PRIMARY KEY NOT NULL,
 room_id TEXT NOT NULL REFERENCES rooms(id),
 token_hash TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 stop_id TEXT NOT NULL,
 slot INTEGER NOT NULL CHECK(slot BETWEEN 0 AND 5),
 UNIQUE(room_id,name),
 UNIQUE(room_id,slot)
);
CREATE INDEX room_members_room ON room_members(room_id);
