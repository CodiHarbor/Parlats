-- 006_api_keys.sql

CREATE TABLE api_keys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  name       VARCHAR(255) NOT NULL,
  key_prefix CHAR(8) NOT NULL,
  key_hash   TEXT NOT NULL,
  scopes     JSONB NOT NULL DEFAULT '{"projects":["*"],"permissions":["read"]}',
  rate_limit INTEGER NOT NULL DEFAULT 100,
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_org ON api_keys(org_id);
