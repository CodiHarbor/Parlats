-- 011_session_token_nullable.sql
-- Stop storing plaintext session tokens. Only the SHA-256 hash is needed.
-- Clear all existing plaintext tokens and make the column nullable.

-- First, migrate any remaining sessions that don't have a hash
-- (they will be invalidated — users will need to log in again)
DELETE FROM sessions WHERE token_hash IS NULL;

-- Clear all plaintext tokens
UPDATE sessions SET token = NULL WHERE token IS NOT NULL AND token != 'migrated';
UPDATE sessions SET token = NULL WHERE token = 'migrated';

-- Make token column nullable (it was NOT NULL)
ALTER TABLE sessions ALTER COLUMN token DROP NOT NULL;
ALTER TABLE sessions ALTER COLUMN token DROP DEFAULT;

-- Drop the unique constraint on token (keep index on token_hash)
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_token_key;
DROP INDEX IF EXISTS idx_sessions_token;
