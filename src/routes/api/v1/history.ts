import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiList, apiError, parsePagination } from "../../../lib/api-helpers.ts";

/** GET /api/v1/projects/:id/history — change history */
export async function GET(_req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const projectId = ctx.params.id;

  const [project] = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND org_id = ${ctx.org.id}
  `;
  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  const { page, perPage, offset } = parsePagination(ctx.query);

  const [{ count: total }] = await sql`
    SELECT COUNT(*)::int AS count FROM change_operations
    WHERE project_id = ${projectId} AND org_id = ${ctx.org.id}
  `;

  const operations = await sql`
    SELECT co.id, co.type, co.summary, co.created_at,
           u.name AS user_name, u.email AS user_email,
           (SELECT COUNT(*)::int FROM change_details cd WHERE cd.operation_id = co.id) AS detail_count
    FROM change_operations co
    LEFT JOIN users u ON u.id = co.user_id
    WHERE co.project_id = ${projectId} AND co.org_id = ${ctx.org.id}
    ORDER BY co.created_at DESC
    LIMIT ${perPage} OFFSET ${offset}
  `;

  return apiList(operations, { total, page, perPage });
}
