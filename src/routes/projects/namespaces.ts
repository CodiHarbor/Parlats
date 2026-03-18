import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** POST /projects/:id/namespaces — create a namespace */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT id FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }

  const formData = await req.formData();
  const name = (formData.get("name") as string || "").trim();

  if (!name) {
    return Response.redirect(`/projects/${project.id}`, 303);
  }

  // Get next sort order
  const [{ max_order }] = await sql`
    SELECT COALESCE(MAX(sort_order), -1) AS max_order
    FROM namespaces WHERE project_id = ${project.id}
  `;

  await sql`
    INSERT INTO namespaces (project_id, name, sort_order)
    VALUES (${project.id}, ${name}, ${max_order + 1})
    ON CONFLICT (project_id, name) DO NOTHING
  `;

  captureBusinessEvent("namespace_created", ctx, { project_id: project.id });

  return Response.redirect(`/projects/${project.id}`, 303);
}
