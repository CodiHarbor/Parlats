import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";

/** GET /projects/:id/editor — main translation editor page */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT id, name, interpolation_format, default_language, default_namespace_id FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }

  const languages = await sql`
    SELECT * FROM project_languages
    WHERE project_id = ${project.id}
    ORDER BY CASE WHEN language_code = ${project.default_language} THEN 0 ELSE 1 END, language_code
  `;

  const namespaces = await sql`
    SELECT * FROM namespaces
    WHERE project_id = ${project.id}
    ORDER BY sort_order, name
  `;

  // Default to project's default namespace, then first namespace
  const url = new URL(req.url);
  const activeNsId = url.searchParams.get("namespace") || project.default_namespace_id || (namespaces[0]?.id ?? "");
  const importedCount = url.searchParams.get("imported") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = url.searchParams.get("search") || "";
  const missing = url.searchParams.get("missing") || "";

  return render("pages/editor.njk", {
    project,
    languages,
    namespaces,
    activeNsId,
    importedCount,
    page,
    search,
    missing,
    ctx,
    activePage: "projects",
  });
}
