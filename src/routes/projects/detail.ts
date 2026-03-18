import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";

/** GET /projects/:id — show project detail */
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT p.*,
      (SELECT COUNT(*) FROM project_languages pl WHERE pl.project_id = p.id) AS language_count,
      (SELECT COUNT(*) FROM namespaces n
        JOIN translation_keys tk ON tk.namespace_id = n.id
        WHERE n.project_id = p.id) AS key_count
    FROM projects p
    WHERE p.id = ${ctx.params.id} AND p.org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  }

  const languages = await sql`
    SELECT * FROM project_languages
    WHERE project_id = ${project.id}
    ORDER BY language_code
  `;

  const namespaces = await sql`
    SELECT n.*,
      (SELECT COUNT(*) FROM translation_keys tk WHERE tk.namespace_id = n.id) AS key_count
    FROM namespaces n
    WHERE n.project_id = ${project.id}
    ORDER BY n.sort_order, n.name
  `;

  return render("pages/project-detail.njk", {
    project,
    languages,
    namespaces,
    ctx,
    activePage: "projects",
  });
}
