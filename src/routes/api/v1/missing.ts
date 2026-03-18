import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiList, apiError, parsePagination } from "../../../lib/api-helpers.ts";

/** GET /api/v1/projects/:id/missing/:lang — keys missing translations for a language */
export async function GET(_req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const { id: projectId, lang } = ctx.params;

  const [project] = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND org_id = ${ctx.org.id}
  `;
  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  // Verify language is configured
  const [langRow] = await sql`
    SELECT language_code FROM project_languages
    WHERE project_id = ${projectId} AND language_code = ${lang}
  `;
  if (!langRow) {
    return apiError("VALIDATION_ERROR", `Language '${lang}' is not configured for this project`, 400);
  }

  const { page, perPage, offset } = parsePagination(ctx.query);

  const [{ count: total }] = await sql`
    SELECT COUNT(*)::int AS count FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE n.project_id = ${projectId}
    AND NOT EXISTS (
      SELECT 1 FROM translations t
      WHERE t.translation_key_id = tk.id AND t.language_code = ${lang}
        AND t.value IS NOT NULL AND t.value != ''
    )
  `;

  const keys = await sql`
    SELECT tk.id, tk.key, n.name AS namespace, tk.created_at
    FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE n.project_id = ${projectId}
    AND NOT EXISTS (
      SELECT 1 FROM translations t
      WHERE t.translation_key_id = tk.id AND t.language_code = ${lang}
        AND t.value IS NOT NULL AND t.value != ''
    )
    ORDER BY tk.key
    LIMIT ${perPage} OFFSET ${offset}
  `;

  return apiList(keys, { total, page, perPage });
}
