-- 016_invitation_token_nullable.sql
-- Allow token column to be NULL since we now store only the hash.

ALTER TABLE invitations ALTER COLUMN token DROP NOT NULL;
