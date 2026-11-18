CREATE TABLE room_members_unbounded (
 id TEXT PRIMARY KEY NOT NULL,
 room_id TEXT NOT NULL REFERENCES rooms(id),
 token_hash TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 stop_id TEXT NOT NULL,
 slot INTEGER NOT NULL CHECK(slot >= 0),
 UNIQUE(room_id,name),
 UNIQUE(room_id,slot)
);
INSERT INTO room_members_unbounded (id,room_id,token_hash,name,stop_id,slot)
 SELECT id,room_id,token_hash,name,stop_id,slot FROM room_members;
DROP TABLE room_members;
ALTER TABLE room_members_unbounded RENAME TO room_members;
CREATE INDEX room_members_room ON room_members(room_id);
