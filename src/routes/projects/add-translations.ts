import { z } from "zod/v4";
import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { recordChange } from "../../lib/change-tracking.ts";
import type { ChangeDetail } from "../../lib/change-tracking.ts";
import { isValidUuid } from "../../lib/validation.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

const addTranslationsSchema = z.object({
  namespace_id: z.string().refine(isValidUuid, "Invalid namespace ID"),
  entries: z.array(z.object({
    key: z.string().min(1).max(500),
    translations: z.record(z.string(), z.string().max(10000)).optional().default({}),
  })).min(1).max(500),
});

/** GET /projects/:id/add-translations — spreadsheet-like translation entry page */
export async function GET(
  req: Request,
  ctx: AuthenticatedContext,
): Promise<Response> {
  const [project] = await sql`
    SELECT id, name, default_namespace_id, default_language
    FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  }

  const namespaces = await sql`
    SELECT id, name FROM namespaces
    WHERE project_id = ${project.id}
    ORDER BY sort_order, name
  `;

  const languages = await sql`
    SELECT language_code FROM project_languages
    WHERE project_id = ${project.id}
    ORDER BY CASE WHEN language_code = ${project.default_language} THEN 0 ELSE 1 END, language_code
  `;

  const url = new URL(req.url);
  const activeNsId =
    url.searchParams.get("namespace") ||
    project.default_namespace_id ||
    (namespaces[0]?.id ?? "");

  return render("pages/add-translations.njk", {
    project,
    namespaces,
    languages,
    activeNsId,
    ctx,
    activePage: "projects",
  });
}

/** POST /projects/:id/add-translations — save translations as JSON */
export async function POST(
  req: Request,
  ctx: AuthenticatedContext,
): Promise<Response> {
  const [project] = await sql`
    SELECT id, name FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return Response.json({ ok: false, error: "Project not found" }, { status: 404 });
  }

  let body: z.infer<typeof addTranslationsSchema>;

  try {
    const raw = await req.json();
    body = addTranslationsSchema.parse(raw);
  } catch (err) {
    const message = err instanceof z.ZodError
      ? err.issues.map((e: any) => e.message).join(", ")
      : "Invalid JSON body";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }

  // Validate namespace belongs to project
  const [ns] = await sql`
    SELECT id FROM namespaces
    WHERE id = ${body.namespace_id} AND project_id = ${project.id}
  `;

  if (!ns) {
    return Response.json(
      { ok: false, error: "Namespace not found in this project" },
      { status: 400 },
    );
  }

  let count = 0;
  const changeDetails: ChangeDetail[] = [];

  await sql.begin(async (tx) => {
    for (const entry of body.entries) {
      const keyName = (entry.key || "").trim();
      if (!keyName) continue;

      // Upsert translation key
      const [keyRow] = await tx`
        INSERT INTO translation_keys (namespace_id, key)
        VALUES (${body.namespace_id}, ${keyName})
        ON CONFLICT (namespace_id, key) DO UPDATE SET key = EXCLUDED.key
        RETURNING id
      `;

      const keyId = keyRow.id;
      count++;

      changeDetails.push({
        keyId,
        keyName,
        languageCode: "",
        action: "created",
        oldValue: null,
        newValue: null,
      });

      // Upsert translations for each language
      if (entry.translations) {
        for (const [langCode, value] of Object.entries(entry.translations)) {
          const trimmedValue = (value || "").trim();
          if (!trimmedValue) continue;

          await tx`
            INSERT INTO translations (translation_key_id, language_code, value)
            VALUES (${keyId}, ${langCode}, ${trimmedValue})
            ON CONFLICT (translation_key_id, language_code)
            DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
          `;

          changeDetails.push({
            keyId,
            keyName,
            languageCode: langCode,
            action: "created",
            oldValue: null,
            newValue: trimmedValue,
          });
        }
      }
    }

    if (count > 0) {
      await recordChange(tx, {
        orgId: ctx.org.id,
        projectId: project.id,
        userId: ctx.user.id,
        type: "batch_add",
        summary: `Added ${count} translations`,
        metadata: { keyCount: count },
        details: changeDetails,
      });
    }
  });

  captureBusinessEvent("key_created", ctx, { project_id: project.id });

  return Response.json({ ok: true, count });
}
