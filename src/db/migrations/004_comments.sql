-- 004_comments.sql — Comments on translation keys
CREATE TABLE comments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  translation_key_id UUID NOT NULL REFERENCES translation_keys(id) ON DELETE CASCADE,
  language_code      VARCHAR(20),
  user_id            UUID NOT NULL REFERENCES users(id),
  body               TEXT NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_comments_key ON comments(translation_key_id);
CREATE INDEX idx_comments_key_lang ON comments(translation_key_id, language_code);
