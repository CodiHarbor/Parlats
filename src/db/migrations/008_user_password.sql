-- 008_user_password.sql
-- Add password_hash column for email/password authentication.
-- Nullable because OAuth-only users won't have a password.
ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT NULL;
