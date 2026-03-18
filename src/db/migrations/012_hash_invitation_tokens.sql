-- 012_hash_invitation_tokens.sql
-- Store invitation tokens as SHA-256 hashes (like sessions).
-- The plaintext token is only sent in the email/URL, never stored.

ALTER TABLE invitations ADD COLUMN token_hash TEXT;

-- Existing tokens will expire within 7 days; no need to migrate them.
-- New invitations will only use token_hash.

CREATE UNIQUE INDEX idx_invitations_token_hash ON invitations(token_hash);
