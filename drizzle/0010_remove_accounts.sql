-- Preserve existing opaque access tokens and room/member IDs before removing accounts.
UPDATE rooms SET owner_hash=COALESCE(owner_hash,roster_creator_hash) WHERE creator_user_id IS NOT NULL;
DROP INDEX IF EXISTS room_account_unique;
ALTER TABLE room_members DROP COLUMN user_id;
ALTER TABLE rooms DROP COLUMN creator_user_id;
DROP TABLE auth_sessions;
DROP TABLE oauth_states;
DROP TABLE app_users;
