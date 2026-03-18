import { findConfigPath, loadConfig } from "../lib/config";
import { ParlatsClient, ApiError } from "../lib/api-client";
import * as log from "../lib/logger";

const STATUS_HELP = `
parlats status — show translation progress per locale

Usage: parlats status [options]

Options:
  --json    Output as JSON (for scripting/CI)
  --help    Show this help
`.trim();

export async function run(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(STATUS_HELP);
    return;
  }

  const configPath = await findConfigPath(process.cwd());
  if (!configPath) {
    log.error("No config found. Run `parlats init` first.");
    process.exit(1);
  }

  const config = await loadConfig(configPath);
  const apiKey = process.env[config.api_key_env];
  if (!apiKey) {
    log.error(`Environment variable ${config.api_key_env} is not set.`);
    process.exit(1);
  }

  const client = new ParlatsClient(config.host, apiKey);
  const project = await client.getProject(config.project_id);
  const totalKeys = project.stats.key_count;

  if (totalKeys === 0) {
    log.info("Project has no translation keys.");
    return;
  }

  // Parallel requests for missing counts
  const missingCounts = await Promise.all(
    project.languages.map(async (lang) => ({
      code: lang,
      missing: await client.getMissingCount(config.project_id, lang),
    }))
  );

  const results = missingCounts.map((m) => ({
    locale: m.code,
    translated: totalKeys - m.missing,
    missing: m.missing,
    progress: totalKeys > 0 ? ((totalKeys - m.missing) / totalKeys) * 100 : 0,
  }));

  if (flags.json) {
    console.log(JSON.stringify({ total_keys: totalKeys, languages: results }, null, 2));
    return;
  }

  // Table output
  log.info(`Project: ${project.name} (${totalKeys} keys)\n`);
  log.table(
    ["Locale", "Translated", "Missing", "Progress"],
    results.map((r) => [
      r.locale,
      String(r.translated),
      String(r.missing),
      `${r.progress.toFixed(1)}%`,
    ])
  );
}
