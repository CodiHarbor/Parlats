/**
 * Dev runner — starts app server, Tailwind CSS watcher, and Stripe webhook listener.
 * Usage: bun run dev
 */

const PORT = Bun.env.PORT || "3100";

// 1. Build CSS once before starting anything
console.log("[dev] Building CSS...");
const cssBuild = Bun.spawnSync(
  ["bunx", "@tailwindcss/cli", "-i", "src/styles/app.css", "-o", "public/tailwind.css"],
  { stdout: "inherit", stderr: "inherit" },
);
if (cssBuild.exitCode !== 0) {
  console.error("[dev] CSS build failed");
  process.exit(1);
}
console.log("[dev] CSS built.\n");

// 2. Get Stripe webhook secret
console.log("[dev] Getting Stripe webhook secret...");
const secretResult = Bun.spawnSync(["stripe", "listen", "--print-secret"], {
  stdout: "pipe",
  stderr: "pipe",
});
const webhookSecret = new TextDecoder().decode(secretResult.stdout).trim();
if (!webhookSecret.startsWith("whsec_")) {
  console.error("[dev] Failed to get Stripe webhook secret. Is `stripe login` done?");
  process.exit(1);
}
console.log(`[dev] Stripe webhook secret: ${webhookSecret.slice(0, 10)}...\n`);

// 3. Start all processes
const stripe = Bun.spawn(
  ["stripe", "listen", "--forward-to", `localhost:${PORT}/billing/webhook`],
  { stdout: "inherit", stderr: "inherit" },
);

const cssWatch = Bun.spawn(
  ["bunx", "@tailwindcss/cli", "-i", "src/styles/app.css", "-o", "public/tailwind.css", "--watch"],
  { stdout: "inherit", stderr: "inherit" },
);

const app = Bun.spawn(["bun", "--hot", "src/index.ts"], {
  stdout: "inherit",
  stderr: "inherit",
  env: { ...Bun.env, STRIPE_WEBHOOK_SECRET: webhookSecret },
});

console.log(`[dev] All processes started. App at http://localhost:${PORT}\n`);

// Cleanup on exit
function shutdown() {
  console.log("\n[dev] Shutting down...");
  stripe.kill();
  cssWatch.kill();
  app.kill();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.exited;
shutdown();
