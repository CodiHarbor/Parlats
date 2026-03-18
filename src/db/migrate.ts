import { sql } from "./client.ts";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

/** Run pending migrations. Safe to call multiple times (idempotent). */
export async function runMigrations() {
  // Ensure _migrations tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `;

  // Get already-applied migrations
  const applied = await sql`SELECT name FROM _migrations ORDER BY name`;
  const appliedSet = new Set(applied.map((r: { name: string }) => r.name));

  // Read migration files
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  let count = 0;

  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }

    const filePath = join(MIGRATIONS_DIR, file);
    const content = await Bun.file(filePath).text();

    console.log(`Applying: ${file}`);

    await sql.begin(async (tx) => {
      // Execute the migration SQL
      await tx.unsafe(content);
      // Record it
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });

    count++;
    console.log(`  Applied: ${file}`);
  }

  if (count === 0) {
    console.log("All migrations already applied.");
  } else {
    console.log(`\nApplied ${count} migration(s).`);
  }
}

// Run as CLI script: `bun src/db/migrate.ts`
if (import.meta.main) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
