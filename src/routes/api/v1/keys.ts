import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiList, apiSuccess, apiError, parsePagination } from "../../../lib/api-helpers.ts";
import { z } from "zod/v4";
import { recordChange } from "../../../lib/change-tracking.ts";

/** GET /api/v1/projects/:id/keys — list translation keys (paginated, searchable) */
export async function GET(_req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const projectId = ctx.params.id;

  if (!ctx.apiKey.scopes.permissions.includes("read")) {
    return apiError("FORBIDDEN", "API key lacks 'read' permission", 403);
  }

  const [project] = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND org_id = ${ctx.org.id}
  `;
  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  const { page, perPage, offset } = parsePagination(ctx.query);
  const search = ctx.query.get("search") || "";
  const namespace = ctx.query.get("namespace") || "";

  // Build conditions
  const conditions: any[] = [sql`n.project_id = ${projectId}`];
  if (namespace) conditions.push(sql`n.name = ${namespace}`);
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(sql`(tk.key ILIKE ${pattern} OR EXISTS (
      SELECT 1 FROM translations t WHERE t.translation_key_id = tk.id AND t.value ILIKE ${pattern}
    ))`);
  }

  // Combine conditions
  const where = conditions.reduce((acc, cond, i) =>
    i === 0 ? cond : sql`${acc} AND ${cond}`
  );

  const [{ count: total }] = await sql`
    SELECT COUNT(*)::int AS count FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE ${where}
  `;

  const keys = await sql`
    SELECT tk.id, tk.key, tk.namespace_id, n.name AS namespace, tk.created_at
    FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE ${where}
    ORDER BY tk.key
    LIMIT ${perPage} OFFSET ${offset}
  `;

  return apiList(keys, { total, page, perPage });
}

const CreateKeysSchema = z.object({
  keys: z.array(z.object({
    name: z.string().min(1).max(255),
    namespace: z.string().max(255).default("default"),
  })).min(1).max(100),
});

/** POST /api/v1/projects/:id/keys — create one or more keys */
export async function POST(req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const projectId = ctx.params.id;

  if (!ctx.apiKey.scopes.permissions.includes("write")) {
    return apiError("FORBIDDEN", "API key lacks 'write' permission", 403);
  }

  const [project] = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND org_id = ${ctx.org.id}
  `;
  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const result = CreateKeysSchema.safeParse(body);
  if (!result.success) {
    return apiError("VALIDATION_ERROR", result.error.issues.map(i => i.message).join(", "), 400);
  }

  const created: any[] = [];

  await sql.begin(async (tx) => {
    for (const keyDef of result.data.keys) {
      // Find or create namespace
      let [ns] = await tx`
        SELECT id FROM namespaces
        WHERE project_id = ${projectId} AND name = ${keyDef.namespace}
      `;
      if (!ns) {
        [ns] = await tx`
          INSERT INTO namespaces (project_id, name, sort_order)
          VALUES (${projectId}, ${keyDef.namespace}, 0)
          RETURNING id
        `;
      }

      // Skip duplicates
      const [existing] = await tx`
        SELECT id FROM translation_keys
        WHERE namespace_id = ${ns.id} AND key = ${keyDef.name}
      `;
      if (existing) continue;

      const [newKey] = await tx`
        INSERT INTO translation_keys (namespace_id, key)
        VALUES (${ns.id}, ${keyDef.name})
        RETURNING id, key, namespace_id, created_at
      `;
      created.push({ ...newKey, namespace: keyDef.namespace });
    }

    if (created.length > 0) {
      await recordChange(tx, {
        orgId: ctx.org.id,
        projectId,
        userId: ctx.user.id,
        type: "batch_add",
        summary: `API: Added ${created.length} key(s)`,
        details: created.map(k => ({
          keyId: k.id,
          keyName: k.key,
          languageCode: "",
          action: "created" as const,
          oldValue: null,
          newValue: null,
        })),
      });
    }
  });

  return apiSuccess({ created, count: created.length }, 201);
}
