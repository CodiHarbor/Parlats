import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";

/** GET /projects/:id/history/:operationId — operation detail */
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT id, name FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) return new Response("Not found", { status: 404 });

  const [operation] = await sql`
    SELECT co.*, u.name AS user_name, u.email AS user_email
    FROM change_operations co
    JOIN users u ON u.id = co.user_id
    WHERE co.id = ${ctx.params.operationId} AND co.project_id = ${project.id}
  `;
  if (!operation) return new Response("Not found", { status: 404 });

  const details = await sql`
    SELECT * FROM change_details
    WHERE operation_id = ${operation.id}
    ORDER BY key_name, language_code
  `;

  // Parse metadata
  let metadata: Record<string, unknown> = {};
  try {
    metadata = typeof operation.metadata === "string"
      ? JSON.parse(operation.metadata)
      : (operation.metadata ?? {});
  } catch { /* ignore */ }

  return render("pages/history-detail.njk", {
    project,
    operation,
    details,
    metadata,
    ctx,
    activePage: "projects",
  });
}
