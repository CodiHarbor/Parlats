import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiList } from "../../../lib/api-helpers.ts";

/** GET /api/v1/projects — list projects in org */
export async function GET(_req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const projects = await sql`
    SELECT
      p.id, p.name, p.slug, p.description, p.default_language,
      p.interpolation_format, p.created_at,
      (SELECT COUNT(*) FROM project_languages pl WHERE pl.project_id = p.id)::int AS language_count,
      (SELECT COUNT(*) FROM translation_keys tk
        JOIN namespaces n ON n.id = tk.namespace_id
        WHERE n.project_id = p.id)::int AS key_count
    FROM projects p
    WHERE p.org_id = ${ctx.org.id}
    ORDER BY p.name ASC
  `;

  return apiList(projects, { total: projects.length, page: 1, perPage: projects.length });
}
