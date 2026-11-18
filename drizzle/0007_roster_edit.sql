ALTER TABLE rooms ADD COLUMN roster_creator_hash TEXT;
UPDATE rooms SET roster_creator_hash=owner_hash WHERE owner_hash IS NOT NULL;
