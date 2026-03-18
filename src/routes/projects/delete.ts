import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** POST /projects/:id/delete — delete a project */
export async function POST(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const result = await sql`
    DELETE FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
    RETURNING id
  `;

  if (result.length === 0) {
    return new Response("Project not found", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  }

  captureBusinessEvent("project_deleted", ctx, { project_id: ctx.params.id });

  return Response.redirect("/projects", 303);
}
