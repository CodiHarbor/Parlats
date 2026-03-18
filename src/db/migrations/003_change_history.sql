-- 003_change_history.sql
-- Change tracking: operations (high-level) and details (per-key changes)

CREATE TABLE change_operations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  type        VARCHAR(50) NOT NULL,
  summary     TEXT DEFAULT '' NOT NULL,
  metadata    JSONB DEFAULT '{}' NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_change_ops_project ON change_operations(project_id, created_at DESC);

CREATE TABLE change_details (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id    UUID NOT NULL REFERENCES change_operations(id) ON DELETE CASCADE,
  key_id          UUID REFERENCES translation_keys(id) ON DELETE SET NULL,
  key_name        VARCHAR(500) NOT NULL DEFAULT '',
  language_code   VARCHAR(20) NOT NULL DEFAULT '',
  action          VARCHAR(20) NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  old_value       TEXT,
  new_value       TEXT
);

CREATE INDEX idx_change_details_op ON change_details(operation_id);
