import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";

/** GET /projects/:id/import — import wizard page */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const error = url.searchParams.get("error") || "";

  return render("pages/import.njk", { project, error, ctx, activePage: "projects" });
}
