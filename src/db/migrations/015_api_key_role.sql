-- 015_api_key_role.sql
-- Store the creator's org role at key creation time.
-- API keys now operate with this role instead of hardcoded 'owner'.

ALTER TABLE api_keys ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'dev'
  CHECK (role IN ('owner', 'admin', 'dev', 'translator'));

-- Set existing keys to 'owner' for backward compatibility
UPDATE api_keys SET role = 'owner';
