-- Hash session tokens for security
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
