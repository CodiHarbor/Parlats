import yaml from "js-yaml";
import { readFile, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";

export interface CliConfig {
  host: string;
  project_id: string;
  api_key_env: string;
  source_locale: string;
  files: {
    path: string;
    format: "json-nested" | "json-flat";
  };
}

export async function loadConfig(filePath: string): Promise<CliConfig> {
  const content = await readFile(filePath, "utf-8");
  const raw = yaml.load(content) as Record<string, unknown>;

  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid config: file is empty or not a YAML object");
  }

  const host = raw.host;
  const project_id = raw.project_id;
  const files = raw.files as Record<string, unknown> | undefined;

  if (typeof host !== "string" || !host) {
    throw new Error("Invalid config: 'host' is required");
  }
  if (typeof project_id !== "string" || !project_id) {
    throw new Error("Invalid config: 'project_id' is required");
  }
  if (!files || typeof files !== "object") {
    throw new Error("Invalid config: 'files' section is required");
  }
  if (typeof files.path !== "string" || !files.path) {
    throw new Error("Invalid config: 'files.path' is required");
  }
  if (typeof files.format !== "string" || !files.format) {
    throw new Error("Invalid config: 'files.format' is required");
  }
  const validFormats = ["json-nested", "json-flat"];
  if (!validFormats.includes(files.format)) {
    throw new Error(`Invalid config: 'files.format' must be one of: ${validFormats.join(", ")}`);
  }

  return {
    host,
    project_id,
    api_key_env:
      typeof raw.api_key_env === "string" && raw.api_key_env
        ? raw.api_key_env
        : "PARLATS_API_KEY",
    source_locale:
      typeof raw.source_locale === "string" && raw.source_locale
        ? raw.source_locale
        : "en",
    files: {
      path: files.path as string,
      format: files.format as "json-nested" | "json-flat",
    },
  };
}

export async function findConfigPath(
  startDir: string
): Promise<string | null> {
  let dir = startDir;

  while (true) {
    const candidate = join(dir, ".parlats.yml");
    try {
      await access(candidate);
      return candidate;
    } catch {
      // not found, walk up
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function writeConfig(
  filePath: string,
  config: CliConfig
): Promise<void> {
  const content = yaml.dump(
    {
      host: config.host,
      project_id: config.project_id,
      api_key_env: config.api_key_env,
      source_locale: config.source_locale,
      files: {
        path: config.files.path,
        format: config.files.format,
      },
    },
    { lineWidth: -1, quotingType: '"', forceQuotes: true }
  );
  await writeFile(filePath, content, "utf-8");
}
