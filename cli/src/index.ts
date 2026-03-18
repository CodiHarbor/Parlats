#!/usr/bin/env node

const VERSION = "1.0.2";

const HELP = `
parlats — sync translations with Parlats

Usage: parlats <command> [options]

Commands:
  init          Set up .parlats.yml for this project
  pull          Download translations from server
  push          Upload source translations to server
  status        Show translation progress per locale

Options:
  --help        Show this help
  --version     Show version

Run 'parlats <command> --help' for command-specific options.
`.trim();

function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean>; args: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }
  return { command: positional[0] || "", flags, args: positional.slice(1) };
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (flags.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (flags.help && !command) {
    console.log(HELP);
    process.exit(0);
  }

  switch (command) {
    case "init": {
      const { run } = await import("./commands/init");
      await run(flags);
      break;
    }
    case "pull": {
      const { run } = await import("./commands/pull");
      await run(flags);
      break;
    }
    case "push": {
      const { run } = await import("./commands/push");
      await run(flags);
      break;
    }
    case "status": {
      const { run } = await import("./commands/status");
      await run(flags);
      break;
    }
    default:
      if (command) {
        console.error(`Unknown command: ${command}\n`);
      }
      console.log(HELP);
      process.exit(command ? 1 : 0);
  }
}

main().catch(async (err) => {
  const { ApiError } = await import("./lib/api-client");
  if (err instanceof ApiError) {
    switch (err.status) {
      case 0:
        console.error(`error ${err.message}`);
        break;
      case 401:
        console.error("error Invalid API key. Check your PARLATS_API_KEY.");
        break;
      case 403:
        console.error(`error ${err.message}`);
        break;
      case 404:
        console.error(`error ${err.message}`);
        break;
      default:
        console.error(`error ${err.message}`);
    }
  } else if (err?.message?.includes("Invalid config")) {
    console.error(`error Invalid .parlats.yml: ${err.message}`);
  } else {
    console.error(`error ${err.message || err}`);
  }
  process.exit(1);
});
