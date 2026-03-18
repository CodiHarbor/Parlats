-- 005_notifications.sql

CREATE TABLE notifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type               TEXT NOT NULL,
  title              TEXT NOT NULL,
  body               TEXT NOT NULL,
  project_id         UUID REFERENCES projects(id) ON DELETE SET NULL,
  translation_key_id UUID REFERENCES translation_keys(id) ON DELETE SET NULL,
  read_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_notifications_user_unread ON notifications(org_id, user_id, read_at);
CREATE INDEX idx_notifications_user_recent ON notifications(org_id, user_id, created_at DESC);

CREATE TABLE email_digest_log (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type     TEXT NOT NULL,
  sent_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_email_digest_cooldown ON email_digest_log(org_id, user_id, type, sent_at DESC);
