import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiSuccess, apiError } from "../../../lib/api-helpers.ts";
import { z } from "zod/v4";
import { recordChange } from "../../../lib/change-tracking.ts";
import { captureBusinessEvent } from "../../../lib/observability/capture.ts";

const UpdateTranslationSchema = z.object({
  lang: z.string().min(2).max(10),
  value: z.string().max(10000),
});

/** PUT /api/v1/projects/:id/translations/:keyId — upsert a translation */
export async function PUT(req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const { id: projectId, keyId } = ctx.params;

  const [project] = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND org_id = ${ctx.org.id}
  `;
  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  const [key] = await sql`
    SELECT tk.id, tk.key FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE tk.id = ${keyId} AND n.project_id = ${projectId}
  `;
  if (!key) return apiError("NOT_FOUND", "Translation key not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const result = UpdateTranslationSchema.safeParse(body);
  if (!result.success) {
    return apiError("VALIDATION_ERROR", result.error.issues.map(i => i.message).join(", "), 400);
  }

  const { lang, value } = result.data;

  // Verify language is configured for project
  const [langRow] = await sql`
    SELECT language_code FROM project_languages
    WHERE project_id = ${projectId} AND language_code = ${lang}
  `;
  if (!langRow) {
    return apiError("VALIDATION_ERROR", `Language '${lang}' is not configured for this project`, 400);
  }

  // Get current value for audit
  const [existing] = await sql`
    SELECT value FROM translations
    WHERE translation_key_id = ${keyId} AND language_code = ${lang}
  `;
  const oldValue = existing?.value || null;

  await sql.begin(async (tx) => {
    if (existing) {
      await tx`
        UPDATE translations SET value = ${value}, updated_by = ${ctx.user.id}, updated_at = NOW()
        WHERE translation_key_id = ${keyId} AND language_code = ${lang}
      `;
    } else {
      await tx`
        INSERT INTO translations (translation_key_id, language_code, value, updated_by)
        VALUES (${keyId}, ${lang}, ${value}, ${ctx.user.id})
      `;
    }

    await recordChange(tx, {
      orgId: ctx.org.id,
      projectId,
      userId: ctx.user.id,
      type: "edit",
      summary: `API: ${existing ? "Updated" : "Added"} translation for '${key.key}' [${lang}]`,
      details: [{
        keyId,
        keyName: key.key,
        languageCode: lang,
        action: existing ? "updated" : "created",
        oldValue,
        newValue: value,
      }],
    });
  });

  captureBusinessEvent("translation_updated", ctx, { project_id: ctx.params.id });
  return apiSuccess({ key_id: keyId, key: key.key, lang, value });
}
