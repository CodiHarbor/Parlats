import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** POST /projects/:id/namespaces/:nsId/delete — delete a namespace */
export async function POST(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT id, default_namespace_id FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }

  // Cannot delete the namespace that is set as the project default
  if (project.default_namespace_id === ctx.params.nsId) {
    return Response.redirect(`/projects/${project.id}`, 303);
  }

  // CASCADE handles translation_keys and translations
  await sql`
    DELETE FROM namespaces
    WHERE id = ${ctx.params.nsId} AND project_id = ${project.id}
  `;

  captureBusinessEvent("namespace_deleted", ctx, { project_id: ctx.params.id });

  return Response.redirect(`/projects/${project.id}`, 303);
}
