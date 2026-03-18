import { findConfigPath, loadConfig } from "../lib/config";
import { ParlatsClient, ApiError } from "../lib/api-client";
import { expandPath, hasNamespacePlaceholder } from "../lib/presets";
import { normalizeJson } from "../lib/normalizer";
import * as log from "../lib/logger";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";
import { createInterface } from "node:readline";

const PUSH_HELP = `
parlats push — upload translations to server

Usage: parlats push [options]

Options:
  --force             Skip confirmation, push everything
  --add-only          Push only new keys (never overwrite)
  --dry-run           Show what would change without uploading
  --namespace <name>  Push specific namespace only
  --locale <codes>    Push specific locales only (comma-separated)
  --help              Show this help
`.trim();

// Separator used internally for flatten/unflatten round-trips.
// Must NOT appear in real translation keys. Using a null byte
// so dotted keys ("home.title") survive.
const SEP = "\x00";

function flattenObject(obj: Record<string, unknown>, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}${SEP}${key}` : key;
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      for (const [k, v] of flattenObject(val as Record<string, unknown>, fullKey)) {
        result.set(k, v);
      }
    } else {
      result.set(fullKey, String(val ?? ""));
    }
  }
  return result;
}

function displayKey(key: string): string {
  return key.replaceAll(SEP, ".");
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

interface DiffResult {
  newKeys: Map<string, string>;
  changedKeys: Map<string, { server: string; local: string }>;
  deletedKeys: string[];
}

function diffMaps(local: Map<string, string>, server: Map<string, string>): DiffResult {
  const newKeys = new Map<string, string>();
  const changedKeys = new Map<string, { server: string; local: string }>();
  const deletedKeys: string[] = [];

  for (const [key, localVal] of local) {
    const serverVal = server.get(key);
    if (serverVal === undefined) {
      newKeys.set(key, localVal);
    } else if (serverVal !== localVal) {
      changedKeys.set(key, { server: serverVal, local: localVal });
    }
  }

  for (const key of server.keys()) {
    if (!local.has(key)) {
      deletedKeys.push(key);
    }
  }

  return { newKeys, changedKeys, deletedKeys };
}

/**
 * Discover all locale codes from local files by scanning the file pattern.
 * For patterns like "messages/{locale}.json" → scan directory for *.json files.
 * For patterns like "public/locales/{locale}/{namespace}.json" → scan for locale directories.
 */
async function discoverLocales(configDir: string, pattern: string): Promise<string[]> {
  const isMultiNs = hasNamespacePlaceholder(pattern);

  if (isMultiNs) {
    // Pattern like "public/locales/{locale}/{namespace}.json"
    // Split at {locale} to get the parent directory
    const parts = pattern.split("{locale}");
    const parentDir = resolve(configDir, parts[0]);
    try {
      const entries = await readdir(parentDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
      return [];
    }
  } else {
    // Pattern like "messages/{locale}.json"
    // Split at {locale} to find directory and suffix
    const parts = pattern.split("{locale}");
    const dir = resolve(configDir, parts[0]);
    const suffix = parts[1] || ""; // e.g. ".json"
    try {
      const entries = await readdir(dir);
      return entries
        .filter((f) => f.endsWith(suffix))
        .map((f) => f.slice(0, f.length - suffix.length))
        .sort();
    } catch {
      return [];
    }
  }
}

export async function run(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(PUSH_HELP);
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
    log.error(`Environment variable ${config.api_key_env} is not set.`);
    process.exit(1);
  }

  const client = new ParlatsClient(config.host, apiKey);
  const project = await client.getProject(config.project_id);
  const isMultiNs = hasNamespacePlaceholder(config.files.path);
  const nsFilter = typeof flags.namespace === "string" ? flags.namespace : null;
  const force = !!flags.force;
  const addOnly = !!flags["add-only"];
  const dryRun = !!flags["dry-run"];

  // Determine which locales to push
  const localeFilter = typeof flags.locale === "string"
    ? flags.locale.split(",").map((s) => s.trim())
    : null;

  let localesToPush: string[];
  if (localeFilter) {
    localesToPush = localeFilter;
  } else {
    localesToPush = await discoverLocales(configDir, config.files.path);
  }

  if (localesToPush.length === 0) {
    log.error("No locale files found. Run `parlats pull` first or check your file pattern.");
    process.exit(1);
  }

  log.info(`Found ${localesToPush.length} locale(s): ${localesToPush.join(", ")}`);

  // Auto-add languages that exist locally but not on the server
  const serverLanguages = new Set(project.languages);
  const missingLanguages = localesToPush.filter((l) => !serverLanguages.has(l));
  if (missingLanguages.length > 0) {
    log.info(`Adding ${missingLanguages.length} new language(s) to project: ${missingLanguages.join(", ")}`);
    for (const lang of missingLanguages) {
      try {
        await client.addLanguage(config.project_id, lang);
      } catch {
        log.warn(`Could not add language '${lang}' — check API key has 'write' scope.`);
      }
    }
  }

  let grandTotalCreated = 0;
  let grandTotalUpdated = 0;
  let grandTotalSkipped = 0;

  for (const lang of localesToPush) {
    // Determine namespaces to push for this locale
    let namespacesToPush: { name: string; localData: Record<string, unknown>; filePath: string }[];

    if (isMultiNs) {
      // i18next style: each file is a namespace
      const pathParts = config.files.path.split("{namespace}");
      const dirPattern = pathParts[0].replace("{locale}", lang);
      const dir = resolve(configDir, dirPattern);

      let files: string[];
      try {
        files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
      } catch {
        log.warn(`No files found for locale ${lang}, skipping.`);
        continue;
      }

      if (nsFilter) {
        files = files.filter((f) => basename(f, ".json") === nsFilter);
      }

      namespacesToPush = await Promise.all(
        files.map(async (f) => {
          const filePath = resolve(dir, f);
          const content = await readFile(filePath, "utf-8");
          return {
            name: basename(f, ".json"),
            localData: JSON.parse(content),
            filePath,
          };
        })
      );
    } else {
      // Single file per locale — may contain namespace top-level keys
      const filePath = resolve(configDir, expandPath(config.files.path, lang));
      let content: string;
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        log.warn(`Source file not found for locale ${lang}, skipping.`);
        continue;
      }
      const parsed = JSON.parse(content);

      if (project.namespaces.length > 1) {
        // Split by top-level keys as namespaces
        const entries = Object.entries(parsed)
          .filter(([ns]) => !nsFilter || ns === nsFilter)
          .map(([ns, data]) => ({
            name: ns,
            localData: data as Record<string, unknown>,
            filePath,
          }));
        namespacesToPush = entries;
      } else {
        namespacesToPush = [{
          name: project.namespaces[0]?.name || "default",
          localData: parsed,
          filePath,
        }];
      }
    }

    // For each namespace: fetch server state, diff, upload
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const ns of namespacesToPush) {
      // Get server state
      let serverContent: string;
      try {
        serverContent = await client.exportFile(config.project_id, config.files.format, lang, ns.name);
      } catch {
        serverContent = "{}";
      }
      const serverData = JSON.parse(serverContent || "{}");

      const localFlat = flattenObject(ns.localData);
      const serverFlat = flattenObject(serverData);
      const diff = diffMaps(localFlat, serverFlat);

      if (diff.newKeys.size === 0 && diff.changedKeys.size === 0) {
        log.dim(`  ${lang}/${ns.name}: no changes`);
        continue;
      }

      // Report
      if (diff.newKeys.size > 0) {
        log.info(`  ${lang}/${ns.name}: ${diff.newKeys.size} new key(s)`);
      }
      if (diff.deletedKeys.length > 0) {
        log.warn(`  ${lang}/${ns.name}: ${diff.deletedKeys.length} key(s) on server but not in local file (not deleted)`);
      }

      // Handle changed keys
      let pushChanges = true;
      if (diff.changedKeys.size > 0) {
        if (addOnly) {
          pushChanges = false;
        } else if (!force && !dryRun) {
          log.warn(`  ${lang}/${ns.name}: ${diff.changedKeys.size} changed value(s):\n`);
          log.table(
            ["Key", "Server Value", "Local Value"],
            Array.from(diff.changedKeys).map(([key, { server, local }]) => [
              displayKey(key),
              server.length > 40 ? server.slice(0, 37) + "..." : server,
              local.length > 40 ? local.slice(0, 37) + "..." : local,
            ])
          );
          const answer = await prompt("\nOverwrite? (y)es / (n)o, new keys only / (a)bort: ");
          if (answer === "a" || answer === "abort") {
            log.info("Aborted.");
            process.exit(0);
          }
          pushChanges = answer === "y" || answer === "yes";
        }
      }

      if (dryRun) {
        log.info(`  ${lang}/${ns.name}: would push ${diff.newKeys.size} new + ${pushChanges ? diff.changedKeys.size : 0} changed`);
        continue;
      }

      // Construct upload data
      let uploadData: Record<string, unknown>;
      if (pushChanges) {
        uploadData = ns.localData;
      } else {
        // Filter to only new keys — rebuild nested object from internal separator keys
        uploadData = {};
        for (const [key, val] of diff.newKeys) {
          const parts = key.split(SEP);
          let obj = uploadData;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!(parts[i] in obj)) {
              (obj as Record<string, unknown>)[parts[i]] = {};
            }
            obj = (obj as Record<string, unknown>)[parts[i]] as Record<string, unknown>;
          }
          (obj as Record<string, unknown>)[parts[parts.length - 1]] = val;
        }
      }

      const json = JSON.stringify(uploadData);
      const blob = new Blob([json], { type: "application/json" });
      const result = await client.importFile(config.project_id, blob, lang, config.files.format, ns.name);

      totalCreated += result.created;
      totalUpdated += result.updated;
      if (!pushChanges) {
        totalSkipped += diff.changedKeys.size;
      }
    }

    // Normalize local files after push
    if (!dryRun) {
      for (const ns of namespacesToPush) {
        if (isMultiNs) {
          const normalized = normalizeJson(ns.localData);
          await writeFile(ns.filePath, normalized, "utf-8");
        }
      }
      if (!isMultiNs && namespacesToPush.length > 0) {
        const filePath = namespacesToPush[0].filePath;
        const content = await readFile(filePath, "utf-8");
        const normalized = normalizeJson(JSON.parse(content));
        await writeFile(filePath, normalized, "utf-8");
      }
    }

    if (totalCreated > 0 || totalUpdated > 0 || totalSkipped > 0) {
      log.success(
        `  ${lang}: ${totalCreated} created, ${totalUpdated} updated` +
        (totalSkipped > 0 ? `, ${totalSkipped} skipped` : "")
      );
    }

    grandTotalCreated += totalCreated;
    grandTotalUpdated += totalUpdated;
    grandTotalSkipped += totalSkipped;
  }

  log.success(
    `\nPushed ${localesToPush.length} locale(s): ${grandTotalCreated} created, ${grandTotalUpdated} updated` +
    (grandTotalSkipped > 0 ? `, ${grandTotalSkipped} skipped` : "")
  );
}
