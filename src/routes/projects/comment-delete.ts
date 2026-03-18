import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** POST /projects/:id/keys/:keyId/comments/:commentId/delete — delete a comment */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [comment] = await sql`
    SELECT c.id, c.user_id, c.translation_key_id FROM comments c
    JOIN translation_keys tk ON tk.id = c.translation_key_id
    JOIN namespaces n ON n.id = tk.namespace_id
    JOIN projects p ON p.id = n.project_id
    WHERE c.id = ${ctx.params.commentId}
      AND tk.id = ${ctx.params.keyId}
      AND p.id = ${ctx.params.id}
      AND p.org_id = ${ctx.org.id}
  `;
  if (!comment) return new Response("Not found", { status: 404 });

  const isAuthor = comment.user_id === ctx.user.id;
  const isAdmin = ctx.org.role === "admin" || ctx.org.role === "owner";
  if (!isAuthor && !isAdmin) return new Response("Forbidden", { status: 403 });

  await sql`DELETE FROM comments WHERE id = ${comment.id}`;

  captureBusinessEvent("comment_deleted", ctx, { project_id: ctx.params.id });

  return new Response("", { status: 200 });
}
