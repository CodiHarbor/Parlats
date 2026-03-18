ALTER TABLE projects ADD COLUMN default_namespace_id UUID REFERENCES namespaces(id) ON DELETE SET NULL;
