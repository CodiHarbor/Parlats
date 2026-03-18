import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { isValidUuid } from "../../lib/validation.ts";

/** GET /projects/:id/add-translations/check-key — check if a key already exists */
export async function GET(
  _req: Request,
  ctx: AuthenticatedContext,
): Promise<Response> {
  const key = ctx.query.get("key")?.trim();
  const namespaceId = ctx.query.get("namespace_id");

  if (!key || !namespaceId || !isValidUuid(namespaceId)) {
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  }

  // Verify project belongs to org
  const [project] = await sql`
    SELECT id FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
  }

  // Check if key exists — scoped to this project's namespace
  const [existing] = await sql`
    SELECT tk.id FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE tk.namespace_id = ${namespaceId}
      AND n.project_id = ${project.id}
      AND tk.key = ${key}
  `;

  if (existing) {
    return new Response(
      `<span class="text-red-400 text-xs">This key already exists in this namespace</span>`,
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  }

  return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
}
