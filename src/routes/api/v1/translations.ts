import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiList, apiError, parsePagination } from "../../../lib/api-helpers.ts";

/** GET /api/v1/projects/:id/translations — list translations */
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
  const lang = ctx.query.get("lang") || "";
  const namespace = ctx.query.get("namespace") || "";

  // Build conditions
  const conditions: any[] = [sql`n.project_id = ${projectId}`];
  if (lang) conditions.push(sql`t.language_code = ${lang}`);
  if (namespace) conditions.push(sql`n.name = ${namespace}`);

  const where = conditions.reduce((acc, cond, i) =>
    i === 0 ? cond : sql`${acc} AND ${cond}`
  );

  const [{ count: total }] = await sql`
    SELECT COUNT(*)::int AS count FROM translations t
    JOIN translation_keys tk ON tk.id = t.translation_key_id
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE ${where}
  `;

  const translations = await sql`
    SELECT t.id, tk.id AS key_id, tk.key, n.name AS namespace,
           t.language_code, t.value, t.updated_at
    FROM translations t
    JOIN translation_keys tk ON tk.id = t.translation_key_id
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE ${where}
    ORDER BY tk.key
    LIMIT ${perPage} OFFSET ${offset}
  `;

  return apiList(translations, { total, page, perPage });
}
