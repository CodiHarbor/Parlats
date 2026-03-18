import type { AuthenticatedContext } from "../types/index.ts";
import { render } from "../lib/templates.ts";
import { sql } from "../db/client.ts";

export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const projects = await sql`
    SELECT p.id, p.name, p.slug, p.description, p.default_language,
      p.interpolation_format, p.created_at, p.updated_at,
      COUNT(DISTINCT pl.language_code)::int AS language_count,
      COUNT(DISTINCT tk.id)::int AS key_count,
      COUNT(DISTINCT t.id) FILTER (WHERE t.value != '')::int AS translated_count,
      (COUNT(DISTINCT tk.id) * GREATEST(COUNT(DISTINCT pl.language_code), 1))::int AS total_cells
    FROM projects p
    LEFT JOIN project_languages pl ON pl.project_id = p.id
    LEFT JOIN namespaces ns ON ns.project_id = p.id
    LEFT JOIN translation_keys tk ON tk.namespace_id = ns.id
    LEFT JOIN translations t ON t.translation_key_id = tk.id
    WHERE p.org_id = ${ctx.org.id}
    GROUP BY p.id
    ORDER BY p.updated_at DESC
    LIMIT 20
  `;

  const [{ count: memberCount }] = await sql`
    SELECT COUNT(*)::int AS count FROM org_members WHERE org_id = ${ctx.org.id}
  `;

  return render("pages/dashboard.njk", {
    projects,
    memberCount,
    ctx,
    activePage: "dashboard",
  });
}
