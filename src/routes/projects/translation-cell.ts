import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";

/** GET /projects/:id/keys/:keyId/cell?lang=xx — display cell partial (for cancel) */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") || "";

  const [translation] = await sql`
    SELECT t.value FROM translations t
    JOIN translation_keys tk ON tk.id = t.translation_key_id
    JOIN namespaces n ON n.id = tk.namespace_id
    JOIN projects p ON p.id = n.project_id
    WHERE tk.id = ${ctx.params.keyId} AND t.language_code = ${lang}
      AND p.id = ${ctx.params.id} AND p.org_id = ${ctx.org.id}
  `;

  return render("partials/editor-cell.njk", {
    project: { id: ctx.params.id },
    keyId: ctx.params.keyId,
    lang,
    value: translation?.value || "",
    ctx,
  });
}
