import { writeConfig, type CliConfig } from "../lib/config";
import { ParlatsClient, ApiError } from "../lib/api-client";
import { PRESETS } from "../lib/presets";
import * as log from "../lib/logger";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";

const INIT_HELP = `
parlats init — set up .parlats.yml for this project

Usage: parlats init [options]

Options:
  --preset <name>   Skip preset selection (next-intl, i18next, next-i18next, react-intl, vue-i18n)
  --host <url>      Skip host prompt
  --project <id>    Skip project prompt (UUID)
  --help            Show this help
`.trim();

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function run(flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help) {
    console.log(INIT_HELP);
    return;
  }

  const outputPath = join(process.cwd(), ".parlats.yml");

  // Check if config already exists
  try {
    await access(outputPath);
    log.warn(".parlats.yml already exists in this directory.");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await ask(rl, "Overwrite? (y/N): ");
    rl.close();
    if (answer.toLowerCase() !== "y") {
      log.info("Aborted.");
      return;
    }
  } catch {
    // File doesn't exist, proceed
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // 1. Host
  let host: string;
  if (typeof flags.host === "string") {
    host = flags.host;
  } else {
    host = (await ask(rl, "Parlats server URL [https://parlats.com]: ")) || "https://parlats.com";
  }
  host = host.replace(/\/+$/, "");

  // 2. Project
  let projectId: string;
  if (typeof flags.project === "string") {
    projectId = flags.project;
  } else {
    const apiKey = process.env.PARLATS_API_KEY;
    if (apiKey) {
      // Try to list projects
      try {
        const client = new ParlatsClient(host, apiKey);
        const projects = await client.listProjects();
        if (projects.length > 0) {
          console.log("\nProjects:");
          projects.forEach((p, i) => {
            console.log(`  ${i + 1}. ${p.name} (${p.slug})`);
          });
          const choice = await ask(rl, `\nSelect project [1-${projects.length}]: `);
          const idx = parseInt(choice, 10) - 1;
          if (idx >= 0 && idx < projects.length) {
            projectId = projects[idx].id;
            log.info(`Selected: ${projects[idx].name}`);
          } else {
            log.warn("Invalid selection. Enter project UUID manually.");
            projectId = await ask(rl, "Project UUID: ");
          }
        } else {
          log.warn("No projects found. Enter project UUID manually.");
          projectId = await ask(rl, "Project UUID: ");
        }
      } catch {
        log.warn("Could not fetch projects. Enter project UUID manually.");
        projectId = await ask(rl, "Project UUID: ");
      }
    } else {
      log.info("Set PARLATS_API_KEY to auto-discover projects.");
      projectId = await ask(rl, "Project UUID: ");
    }
  }

  if (!projectId) {
    log.error("Project ID is required.");
    rl.close();
    process.exit(1);
  }

  // 3. Preset
  let presetName: string;
  if (typeof flags.preset === "string" && flags.preset in PRESETS) {
    presetName = flags.preset;
  } else {
    console.log("\nPresets:");
    const presetKeys = Object.keys(PRESETS);
    presetKeys.forEach((name, i) => {
      console.log(`  ${i + 1}. ${name} — ${PRESETS[name].description}`);
    });
    const choice = await ask(rl, `\nSelect preset [1-${presetKeys.length}]: `);
    const idx = parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < presetKeys.length) {
      presetName = presetKeys[idx];
    } else {
      log.warn("Invalid selection, defaulting to next-intl.");
      presetName = "next-intl";
    }
  }

  const preset = PRESETS[presetName];
  log.info(`Using preset: ${presetName}`);

  // 4. Confirm path
  const pathAnswer = await ask(rl, `File pattern [${preset.path}]: `);
  const filePath = pathAnswer || preset.path;

  // 5. Source locale
  const localeAnswer = await ask(rl, "Source locale [en]: ");
  const sourceLocale = localeAnswer || "en";

  rl.close();

  // Write config
  const config: CliConfig = {
    host,
    project_id: projectId,
    api_key_env: "PARLATS_API_KEY",
    source_locale: sourceLocale,
    files: {
      path: filePath,
      format: preset.format,
    },
  };

  await writeConfig(outputPath, config);
  log.success(`Created .parlats.yml`);

  if (!process.env.PARLATS_API_KEY) {
    console.log(`\nNext steps:`);
    console.log(`  1. Add PARLATS_API_KEY=trad_... to your .env file`);
    console.log(`  2. Run \`parlats pull\` to download translations`);
  } else {
    console.log(`\nRun \`parlats pull\` to download translations.`);
  }
}
