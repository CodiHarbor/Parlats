-- Fix FK constraints that block user deletion (GDPR Art. 17 right to erasure)

-- invitations.invited_by: change from RESTRICT to SET NULL, make nullable
ALTER TABLE invitations ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE invitations DROP CONSTRAINT invitations_invited_by_fkey;
ALTER TABLE invitations ADD CONSTRAINT invitations_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL;

-- comments.user_id: change from RESTRICT to SET NULL, make nullable
ALTER TABLE comments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE comments DROP CONSTRAINT comments_user_id_fkey;
ALTER TABLE comments ADD CONSTRAINT comments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
