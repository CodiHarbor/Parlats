import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiSuccess, apiError } from "../../../lib/api-helpers.ts";

/** GET /api/v1/projects/:id — project details with languages, namespaces, stats */
export async function GET(_req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT p.id, p.name, p.slug, p.description, p.default_language,
           p.interpolation_format, p.created_at
    FROM projects p
    WHERE p.id = ${ctx.params.id} AND p.org_id = ${ctx.org.id}
  `;

  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  const languages = await sql`
    SELECT language_code FROM project_languages
    WHERE project_id = ${project.id} ORDER BY language_code
  `;

  const namespaces = await sql`
    SELECT id, name, sort_order FROM namespaces
    WHERE project_id = ${project.id} ORDER BY sort_order, name
  `;

  const [stats] = await sql`
    SELECT
      (SELECT COUNT(*) FROM translation_keys tk
        JOIN namespaces n ON n.id = tk.namespace_id
        WHERE n.project_id = ${project.id})::int AS key_count,
      (SELECT COUNT(*) FROM translations t
        JOIN translation_keys tk ON tk.id = t.translation_key_id
        JOIN namespaces n ON n.id = tk.namespace_id
        WHERE n.project_id = ${project.id})::int AS translation_count
  `;

  return apiSuccess({
    ...project,
    languages: languages.map((l: any) => l.language_code),
    namespaces,
    stats,
  });
}
