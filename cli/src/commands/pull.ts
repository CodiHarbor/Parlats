import { findConfigPath, loadConfig } from "../lib/config";
import { ParlatsClient, ApiError } from "../lib/api-client";
import { expandPath, hasNamespacePlaceholder } from "../lib/presets";
import { normalizeJson } from "../lib/normalizer";
import * as log from "../lib/logger";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const PULL_HELP = `
parlats pull — download translations from server

Usage: parlats pull [options]

Options:
  --locale <codes>    Pull specific locales only (comma-separated)
  --namespace <name>  Pull specific namespace only
  --dry-run           Show what would change without writing
  --help              Show this help
`.trim();

export async function run(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(PULL_HELP);
    return;
  }

  const configPath = await findConfigPath(process.cwd());
  if (!configPath) {
    log.error("No config found. Run `parlats init` first.");
    process.exit(1);
  }

  const config = await loadConfig(configPath);
  const configDir = dirname(configPath);
  const apiKey = process.env[config.api_key_env];
  if (!apiKey) {
    log.error(`Environment variable ${config.api_key_env} is not set. Set it or add it to .env`);
    process.exit(1);
  }

  const client = new ParlatsClient(config.host, apiKey);

  let project;
  try {
    project = await client.getProject(config.project_id);
  } catch (e) {
    if (e instanceof ApiError) {
      handleApiError(e, config.host);
    }
    throw e;
  }

  const localeFilter = typeof flags.locale === "string"
    ? flags.locale.split(",").map((s) => s.trim())
    : null;
  const nsFilter = typeof flags.namespace === "string" ? flags.namespace : null;

  const languages = localeFilter
    ? project.languages.filter((code) => localeFilter.includes(code))
    : project.languages;

  const namespaces = nsFilter
    ? project.namespaces.filter((ns) => ns.name === nsFilter)
    : project.namespaces;

  const isMultiNamespace = hasNamespacePlaceholder(config.files.path);
  const dryRun = !!flags["dry-run"];
  let filesWritten = 0;

  for (const lang of languages) {
    if (isMultiNamespace) {
      // One file per locale+namespace (i18next style)
      for (const ns of namespaces) {
        const content = await client.exportFile(
          config.project_id, config.files.format, lang, ns.name
        );
        const parsed = JSON.parse(content || "{}");
        const normalized = normalizeJson(parsed);
        const filePath = resolve(configDir, expandPath(config.files.path, lang, ns.name));

        if (dryRun) {
          log.info(`Would write ${filePath}`);
        } else {
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, normalized, "utf-8");
        }
        filesWritten++;
      }
    } else {
      // Single file per locale
      let data: Record<string, unknown>;

      if (namespaces.length > 1) {
        // next-intl style: namespaces as top-level keys
        data = {};
        for (const ns of namespaces) {
          const content = await client.exportFile(
            config.project_id, config.files.format, lang, ns.name
          );
          data[ns.name] = JSON.parse(content || "{}");
        }
      } else {
        // Single namespace or "default" only — flat export
        const nsName = namespaces[0]?.name;
        const content = await client.exportFile(
          config.project_id, config.files.format, lang, nsName
        );
        data = JSON.parse(content || "{}");
      }

      const normalized = normalizeJson(data);
      const filePath = resolve(configDir, expandPath(config.files.path, lang));

      if (dryRun) {
        log.info(`Would write ${filePath}`);
      } else {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, normalized, "utf-8");
      }
      filesWritten++;
    }
  }

  if (dryRun) {
    log.info(`Dry run: ${filesWritten} file(s) would be written`);
  } else {
    log.success(`Pulled ${filesWritten} file(s) for ${languages.length} locale(s)`);
  }
}

function handleApiError(e: ApiError, host: string): never {
  switch (e.status) {
    case 401:
      log.error("Invalid API key. Check your PARLATS_API_KEY.");
      break;
    case 403:
      log.error(e.message.includes("access")
        ? "API key does not have access to this project. Check key's project scope."
        : "API key lacks required permission. 'pull' requires 'read' + 'export' scopes.");
      break;
    case 404:
      log.error("Project not found. Check your .parlats.yml.");
      break;
    default:
      log.error(`Server error: ${e.message}`);
  }
  process.exit(1);
}
