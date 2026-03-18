import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** POST /projects/:id/languages/:code/delete — remove a language */
export async function POST(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }

  // Don't allow deleting the default language
  if (ctx.params.code === project.default_language) {
    return Response.redirect(`/projects/${project.id}/languages`, 303);
  }

  // Delete the language and its translations
  await sql.begin(async (tx) => {
    // Delete translations for this language in this project
    await tx`
      DELETE FROM translations
      WHERE language_code = ${ctx.params.code}
        AND translation_key_id IN (
          SELECT tk.id FROM translation_keys tk
          JOIN namespaces n ON n.id = tk.namespace_id
          WHERE n.project_id = ${project.id}
        )
    `;

    // Delete the language entry
    await tx`
      DELETE FROM project_languages
      WHERE project_id = ${project.id} AND language_code = ${ctx.params.code}
    `;
  });

  captureBusinessEvent("language_deleted", ctx, { project_id: ctx.params.id, language_code: ctx.params.code });

  return Response.redirect(`/projects/${project.id}/languages`, 303);
}
