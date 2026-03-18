-- 002_projects.sql
-- Core translation tables: projects, languages, namespaces, keys, translations

-- Projects (scoped to organization)
CREATE TABLE projects (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  VARCHAR(255) NOT NULL,
  slug                  VARCHAR(100) NOT NULL,
  description           TEXT DEFAULT '' NOT NULL,
  default_language      VARCHAR(10) NOT NULL DEFAULT 'en',
  interpolation_format  VARCHAR(20) NOT NULL DEFAULT 'auto'
                        CHECK (interpolation_format IN ('auto', 'i18next', 'icu', 'custom')),
  interpolation_config  JSONB DEFAULT '{}' NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (org_id, slug)
);

CREATE INDEX idx_projects_org ON projects(org_id);

-- Languages enabled per project
CREATE TABLE project_languages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  language_code   VARCHAR(10) NOT NULL,
  label           VARCHAR(100) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (project_id, language_code)
);

CREATE INDEX idx_project_languages_project ON project_languages(project_id);

-- Namespaces within a project (e.g. "common", "errors", "emails")
CREATE TABLE namespaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  sort_order      INTEGER DEFAULT 0 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (project_id, name)
);

CREATE INDEX idx_namespaces_project ON namespaces(project_id, sort_order);

-- Translation keys within a namespace
CREATE TABLE translation_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace_id    UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  key             VARCHAR(500) NOT NULL,
  description     TEXT DEFAULT '' NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (namespace_id, key)
);

CREATE INDEX idx_keys_namespace ON translation_keys(namespace_id, key);
CREATE INDEX idx_keys_name_search ON translation_keys USING gin(to_tsvector('simple', key));

-- Translation values (one per key per language)
CREATE TABLE translations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  translation_key_id  UUID NOT NULL REFERENCES translation_keys(id) ON DELETE CASCADE,
  language_code       VARCHAR(10) NOT NULL,
  value               TEXT DEFAULT '' NOT NULL,
  updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (translation_key_id, language_code)
);

CREATE INDEX idx_translations_key_lang ON translations(translation_key_id, language_code);
CREATE INDEX idx_translations_value_search ON translations USING gin(to_tsvector('simple', value));
