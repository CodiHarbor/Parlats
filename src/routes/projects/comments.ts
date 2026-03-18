import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** GET /projects/:id/keys/:keyId/comments — load comment thread partial */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") || "";

  const [key] = await sql`
    SELECT tk.id, tk.key FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    JOIN projects p ON p.id = n.project_id
    WHERE tk.id = ${ctx.params.keyId} AND p.id = ${ctx.params.id} AND p.org_id = ${ctx.org.id}
  `;
  if (!key) return new Response("Not found", { status: 404 });

  const comments = await sql`
    SELECT c.*, u.name AS user_name, u.email AS user_email
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.translation_key_id = ${key.id}
    ORDER BY c.created_at ASC
  `;

  return render("partials/comment-thread.njk", {
    project: { id: ctx.params.id },
    keyId: key.id,
    keyName: key.key,
    comments,
    lang,
    ctx,
  });
}

/** POST /projects/:id/keys/:keyId/comments — add a comment */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [key] = await sql`
    SELECT tk.id, tk.key FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    JOIN projects p ON p.id = n.project_id
    WHERE tk.id = ${ctx.params.keyId} AND p.id = ${ctx.params.id} AND p.org_id = ${ctx.org.id}
  `;
  if (!key) return new Response("Not found", { status: 404 });

  const formData = await req.formData();
  const body = (formData.get("body") as string || "").trim();
  const languageCode = (formData.get("language_code") as string) || null;

  if (!body) {
    return new Response("Comment body required", { status: 400 });
  }

  if (body.length > 10000) {
    return new Response("Comment too long (max 10,000 characters)", { status: 400 });
  }

  await sql`
    INSERT INTO comments (translation_key_id, language_code, user_id, body)
    VALUES (${key.id}, ${languageCode}, ${ctx.user.id}, ${body})
  `;

  captureBusinessEvent("comment_added", ctx, { project_id: ctx.params.id });

  // Re-render the full comment thread
  const comments = await sql`
    SELECT c.*, u.name AS user_name, u.email AS user_email
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.translation_key_id = ${key.id}
    ORDER BY c.created_at ASC
  `;

  return render("partials/comment-thread.njk", {
    project: { id: ctx.params.id },
    keyId: key.id,
    keyName: key.key,
    comments,
    lang: languageCode || "",
    ctx,
  });
}
