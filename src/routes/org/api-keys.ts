import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import crypto from "crypto";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** GET /org/api-keys — list all API keys for the org */
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const keys = await sql`
    SELECT ak.id, ak.name, ak.key_prefix, ak.scopes, ak.rate_limit,
           ak.last_used_at, ak.expires_at, ak.revoked_at, ak.created_at,
           u.name AS created_by_name, u.email AS created_by_email
    FROM api_keys ak
    LEFT JOIN users u ON u.id = ak.created_by
    WHERE ak.org_id = ${ctx.org.id}
    ORDER BY ak.created_at DESC
  `;

  // Get projects for scope selector
  const projects = await sql`
    SELECT id, name FROM projects WHERE org_id = ${ctx.org.id} ORDER BY name
  `;

  return render("pages/org/api-keys.njk", {
    keys,
    projects,
    ctx,
    activePage: "api-keys",
  });
}

/** POST /org/api-keys — create a new API key */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const formData = await req.formData();
  const name = (formData.get("name") as string || "").trim();

  if (!name || name.length > 255) {
    return render("partials/api-key-created.njk", {
      error: "Name is required (max 255 characters)",
      ctx,
    }, 422);
  }

  // Parse permissions from checkboxes
  const permissions: string[] = [];
  for (const perm of ["read", "write", "import", "export"]) {
    if (formData.get(`perm_${perm}`) === "on") {
      permissions.push(perm);
    }
  }
  if (permissions.length === 0) {
    permissions.push("read"); // Default to read-only
  }

  // Parse project scope
  const projectScope = formData.get("project_scope") as string || "all";
  let projects: string[] = ["*"];
  if (projectScope === "specific") {
    projects = formData.getAll("projects") as string[];
    if (projects.length === 0) {
      projects = ["*"]; // Fallback to all if none selected
    }
  }

  // Parse optional expiry
  const expiresAtStr = formData.get("expires_at") as string || "";
  const expiresAt = expiresAtStr ? new Date(expiresAtStr) : null;

  // Generate key: trad_<8-char-hex>_<32-char-hex>
  const prefix = crypto.randomBytes(4).toString("hex"); // 8 hex chars
  const secret = crypto.randomBytes(16).toString("hex"); // 32 hex chars
  const fullKey = `trad_${prefix}_${secret}`;

  // Hash the full key
  const keyHash = await Bun.password.hash(fullKey, {
    algorithm: "argon2id",
    memoryCost: 19456,
    timeCost: 2,
  });

  const scopes = { projects, permissions };

  await sql`
    INSERT INTO api_keys (org_id, created_by, name, key_prefix, key_hash, scopes, role, expires_at)
    VALUES (
      ${ctx.org.id}, ${ctx.user.id}, ${name}, ${prefix},
      ${keyHash}, ${JSON.stringify(scopes)}, ${ctx.org.role},
      ${expiresAt}
    )
  `;

  captureBusinessEvent("api_key_created", ctx);

  return render("partials/api-key-created.njk", {
    fullKey,
    name,
    ctx,
  });
}

/** DELETE /org/api-keys/:id — revoke an API key */
export async function DELETE(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const keyId = ctx.params.id;

  const [key] = await sql`
    SELECT id FROM api_keys
    WHERE id = ${keyId} AND org_id = ${ctx.org.id} AND revoked_at IS NULL
  `;

  if (!key) {
    return new Response("Not found", { status: 404 });
  }

  await sql`UPDATE api_keys SET revoked_at = NOW() WHERE id = ${keyId}`;

  captureBusinessEvent("api_key_revoked", ctx);

  // Return updated row for HTMX swap
  const [updated] = await sql`
    SELECT ak.id, ak.name, ak.key_prefix, ak.scopes, ak.rate_limit,
           ak.last_used_at, ak.expires_at, ak.revoked_at, ak.created_at,
           u.name AS created_by_name, u.email AS created_by_email
    FROM api_keys ak
    LEFT JOIN users u ON u.id = ak.created_by
    WHERE ak.id = ${keyId}
  `;

  return render("partials/api-key-row.njk", { key: updated, ctx });
}
