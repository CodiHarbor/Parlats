import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";

/** GET /projects/:id/languages — language management page */
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }

  const languages = await sql`
    SELECT * FROM project_languages
    WHERE project_id = ${project.id}
    ORDER BY language_code
  `;

  return render("pages/project-languages.njk", {
    project,
    languages,
    ctx,
    activePage: "projects",
  });
}

/** POST /projects/:id/languages — add a language */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }

  const formData = await req.formData();
  const language_code = ((formData.get("language_code") as string) || "").trim();

  if (!language_code || language_code.length > 50) {
    return Response.redirect(`/projects/${project.id}/languages`, 303);
  }

  // Ignore duplicates — label is same as code (languages are just text identifiers)
  await sql`
    INSERT INTO project_languages (project_id, language_code, label)
    VALUES (${project.id}, ${language_code}, ${language_code})
    ON CONFLICT (project_id, language_code) DO NOTHING
  `;

  return Response.redirect(`/projects/${project.id}/languages`, 303);
}
