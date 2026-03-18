import { sql } from "bun";

/**
 * Database client using Bun.sql.
 * Connects via DATABASE_URL env var (auto-loaded from .env by Bun).
 * Re-export `sql` for use throughout the app.
 */
export { sql };
