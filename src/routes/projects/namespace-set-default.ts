import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";

/** POST /projects/:id/namespaces/:nsId/set-default — set a namespace as project default */
export async function POST(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT id FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }

  const [ns] = await sql`
    SELECT id FROM namespaces
    WHERE id = ${ctx.params.nsId} AND project_id = ${project.id}
  `;

  if (!ns) {
    return new Response("Namespace not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }

  await sql`
    UPDATE projects SET default_namespace_id = ${ns.id}
    WHERE id = ${project.id}
  `;

  return Response.redirect(`/projects/${project.id}`, 303);
}
