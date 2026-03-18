import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { recordChange } from "../../lib/change-tracking.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT id FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/html" } });
  }

  // Capture key info + translations before deletion (for change tracking)
  const [keyInfo] = await sql`
    SELECT tk.id, tk.key, tk.namespace_id FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE tk.id = ${ctx.params.keyId} AND n.project_id = ${project.id}
  `;

  if (!keyInfo) {
    if (req.headers.get("HX-Request")) return new Response("", { status: 200 });
    return Response.redirect(`/projects/${project.id}/editor`, 303);
  }

  const translations = await sql`
    SELECT language_code, value FROM translations WHERE translation_key_id = ${keyInfo.id}
  `;

  // Delete (CASCADE handles translations)
  await sql`
    DELETE FROM translation_keys
    WHERE id = ${ctx.params.keyId}
      AND namespace_id IN (SELECT id FROM namespaces WHERE project_id = ${project.id})
  `;

  // Record change (key_id is null since it's been deleted)
  const details = translations.length > 0
    ? translations.map(t => ({
        keyId: null as string | null,
        keyName: keyInfo.key,
        languageCode: t.language_code,
        action: "deleted" as const,
        oldValue: t.value,
        newValue: null,
      }))
    : [{
        keyId: null as string | null,
        keyName: keyInfo.key,
        languageCode: "",
        action: "deleted" as const,
        oldValue: null,
        newValue: null,
      }];

  recordChange(sql, {
    orgId: ctx.org.id,
    projectId: project.id,
    userId: ctx.user.id,
    type: "batch_delete",
    summary: `Deleted key "${keyInfo.key}"`,
    details,
  }).catch(() => {});

  captureBusinessEvent("key_deleted", ctx, { project_id: ctx.params.id });

  if (req.headers.get("HX-Request")) {
    return new Response("", { status: 200 });
  }
  return Response.redirect(`/projects/${project.id}/editor?namespace=${keyInfo.namespace_id}`, 303);
}
