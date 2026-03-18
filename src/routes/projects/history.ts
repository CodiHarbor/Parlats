import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";

const PAGE_SIZE = 30;

/** GET /projects/:id/history — full page */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT id, name FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) return new Response("Not found", { status: 404 });

  // If HTMX request, return just the entries partial
  if (req.headers.get("HX-Request")) {
    return renderEntries(req, ctx, project);
  }

  return render("pages/history.njk", {
    project,
    ctx,
    activePage: "projects",
  });
}

/** Render paginated, filtered history entries */
async function renderEntries(
  req: Request,
  ctx: AuthenticatedContext,
  project: { id: string; name: string },
): Promise<Response> {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const typeFilter = url.searchParams.get("type") || "";
  const offset = (page - 1) * PAGE_SIZE;

  // Count total
  const [{ count }] = typeFilter
    ? await sql`
        SELECT COUNT(*) AS count FROM change_operations
        WHERE project_id = ${project.id} AND org_id = ${ctx.org.id} AND type = ${typeFilter}
      `
    : await sql`
        SELECT COUNT(*) AS count FROM change_operations
        WHERE project_id = ${project.id} AND org_id = ${ctx.org.id}
      `;

  const totalOps = Number(count);
  const totalPages = Math.ceil(totalOps / PAGE_SIZE);

  // Fetch operations with user info and detail count
  const operations = typeFilter
    ? await sql`
        SELECT co.*, u.name AS user_name, u.email AS user_email,
          (SELECT COUNT(*) FROM change_details cd WHERE cd.operation_id = co.id) AS detail_count
        FROM change_operations co
        JOIN users u ON u.id = co.user_id
        WHERE co.project_id = ${project.id} AND co.org_id = ${ctx.org.id} AND co.type = ${typeFilter}
        ORDER BY co.created_at DESC
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
      `
    : await sql`
        SELECT co.*, u.name AS user_name, u.email AS user_email,
          (SELECT COUNT(*) FROM change_details cd WHERE cd.operation_id = co.id) AS detail_count
        FROM change_operations co
        JOIN users u ON u.id = co.user_id
        WHERE co.project_id = ${project.id} AND co.org_id = ${ctx.org.id}
        ORDER BY co.created_at DESC
        LIMIT ${PAGE_SIZE} OFFSET ${offset}
      `;

  // Fetch up to 3 preview details per operation
  const opIds = operations.map((o: any) => o.id);
  let previews: Record<string, any[]> = {};
  if (opIds.length > 0) {
    const allPreviews = await sql`
      SELECT cd.* FROM change_details cd
      WHERE cd.operation_id IN ${sql(opIds)}
      ORDER BY cd.operation_id, cd.key_name
    `;
    for (const p of allPreviews) {
      if (!previews[p.operation_id]) previews[p.operation_id] = [];
      if (previews[p.operation_id].length < 3) {
        previews[p.operation_id].push(p);
      }
    }
  }

  // Group operations by date for template rendering (Nunjucks scoping limitation)
  const grouped: { date: string; items: any[] }[] = [];
  let currentGroup: { date: string; items: any[] } | null = null;
  for (const op of operations) {
    const d = new Date(op.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    if (!currentGroup || currentGroup.date !== d) {
      currentGroup = { date: d, items: [] };
      grouped.push(currentGroup);
    }
    currentGroup.items.push(op);
  }

  return render("partials/history-entries.njk", {
    project,
    grouped,
    previews,
    page,
    totalPages,
    totalOps,
    typeFilter,
    ctx,
  });
}
