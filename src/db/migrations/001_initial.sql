-- 001_initial.sql
-- Foundation tables: users, organizations, membership, sessions

-- Organizations
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(100) NOT NULL UNIQUE,
  logo_url        TEXT,
  theme           JSONB DEFAULT '{}' NOT NULL,
  notification_config JSONB DEFAULT '{}' NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Users
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) NOT NULL UNIQUE,
  name            VARCHAR(255) NOT NULL,
  avatar_url      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- OAuth provider links (one user can have multiple providers)
CREATE TABLE user_providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        VARCHAR(50) NOT NULL CHECK (provider IN ('google', 'github', 'azure_ad')),
  provider_id     VARCHAR(255) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (provider, provider_id)
);

CREATE INDEX idx_user_providers_lookup ON user_providers(provider, provider_id);
CREATE INDEX idx_user_providers_user ON user_providers(user_id);

-- Organization membership (many-to-many: users <-> organizations)
CREATE TABLE org_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'admin', 'dev', 'translator')),
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (org_id, user_id)
);

CREATE INDEX idx_org_members_user ON org_members(user_id);
CREATE INDEX idx_org_members_org ON org_members(org_id);

-- Sessions (cookie-based, stored in PostgreSQL)
CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_org_id   UUID REFERENCES organizations(id) ON DELETE SET NULL,
  token           VARCHAR(255) NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Invitations
CREATE TABLE invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           VARCHAR(255) NOT NULL,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'dev', 'translator')),
  token           VARCHAR(255) NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted        BOOLEAN DEFAULT FALSE NOT NULL,
  invited_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_invitations_email ON invitations(email, org_id);
CREATE INDEX idx_invitations_token ON invitations(token);
