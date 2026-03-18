import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { validateTranslation, type ValidationWarning } from "../../lib/interpolation/validate.ts";
import { recordChange } from "../../lib/change-tracking.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** GET /projects/:id/keys/:keyId/edit?lang=xx — edit form partial */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") || "";

  const [key] = await sql`
    SELECT tk.id, tk.key FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    JOIN projects p ON p.id = n.project_id
    WHERE tk.id = ${ctx.params.keyId} AND p.id = ${ctx.params.id} AND p.org_id = ${ctx.org.id}
  `;

  if (!key) {
    return new Response("Not found", { status: 404 });
  }

  // Find existing translation or default to empty
  const [translation] = await sql`
    SELECT id, value FROM translations
    WHERE translation_key_id = ${key.id} AND language_code = ${lang}
  `;

  return render("partials/editor-cell-edit.njk", {
    project: { id: ctx.params.id },
    keyId: key.id,
    lang,
    value: translation?.value || "",
    ctx,
  });
}

/** POST /projects/:id/keys/:keyId/translate?lang=xx — save and return display cell */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") || "";

  const [key] = await sql`
    SELECT tk.id, tk.key FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    JOIN projects p ON p.id = n.project_id
    WHERE tk.id = ${ctx.params.keyId} AND p.id = ${ctx.params.id} AND p.org_id = ${ctx.org.id}
  `;

  if (!key) {
    return new Response("Not found", { status: 404 });
  }

  const formData = await req.formData();
  const value = (formData.get("value") as string) || "";

  // Get existing translation for change tracking
  const [existing] = await sql`
    SELECT value, updated_by FROM translations
    WHERE translation_key_id = ${key.id} AND language_code = ${lang}
  `;
  const oldValue = existing?.value ?? null;
  const isNew = !existing;
  const isChanged = !isNew && oldValue !== value;

  // Upsert translation
  const [translation] = await sql`
    INSERT INTO translations (translation_key_id, language_code, value, updated_by)
    VALUES (${key.id}, ${lang}, ${value}, ${ctx.user.id})
    ON CONFLICT (translation_key_id, language_code)
    DO UPDATE SET value = ${value}, updated_by = ${ctx.user.id}, updated_at = NOW()
    RETURNING id, value
  `;

  // Fire-and-forget change tracking
  if (isNew || isChanged) {
    recordChange(sql, {
      orgId: ctx.org.id,
      projectId: ctx.params.id,
      userId: ctx.user.id,
      type: "edit",
      summary: `Edited ${key.key} (${lang})`,
      metadata: { language: lang, keyName: key.key },
      details: [{
        keyId: key.id,
        keyName: key.key,
        languageCode: lang,
        action: isNew ? "created" : "updated",
        oldValue,
        newValue: value,
      }],
    }).catch(() => {}); // Don't fail the edit if tracking fails
  }

  captureBusinessEvent("translation_updated", ctx, { project_id: ctx.params.id });

  // Validate interpolation tokens against source language
  let warnings: ValidationWarning[] = [];
  const [project] = await sql`
    SELECT interpolation_format, default_language FROM projects
    WHERE id = ${ctx.params.id}
  `;

  if (project && lang !== project.default_language && value) {
    const [sourceTranslation] = await sql`
      SELECT value FROM translations
      WHERE translation_key_id = ${key.id} AND language_code = ${project.default_language}
    `;
    if (sourceTranslation?.value) {
      warnings = validateTranslation(sourceTranslation.value, value, project.interpolation_format);
    }
  }

  return render("partials/editor-cell.njk", {
    project: { id: ctx.params.id, interpolation_format: project?.interpolation_format || "auto" },
    keyId: key.id,
    lang,
    value: translation.value,
    warnings,
    ctx,
  });
}
