import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import type { FileFormat } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiSuccess, apiError } from "../../../lib/api-helpers.ts";
import { parseFile } from "../../../lib/formats/index.ts";
import { recordChange } from "../../../lib/change-tracking.ts";
import type { ChangeDetail } from "../../../lib/change-tracking.ts";
import { captureBusinessEvent } from "../../../lib/observability/capture.ts";

/** POST /api/v1/projects/:id/import — import translations */
export async function POST(req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const projectId = ctx.params.id;

  const [project] = await sql`
    SELECT id, interpolation_format FROM projects
    WHERE id = ${projectId} AND org_id = ${ctx.org.id}
  `;
  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  const contentType = req.headers.get("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return apiError("VALIDATION_ERROR", "Content-Type must be multipart/form-data", 400);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid multipart form data", 400);
  }

  const file = formData.get("file") as File | null;
  const lang = formData.get("lang") as string || "";
  const format = formData.get("format") as FileFormat | null;
  const namespaceName = formData.get("namespace") as string || "default";

  if (!file) return apiError("VALIDATION_ERROR", "Missing 'file' field", 400);
  if (!lang) return apiError("VALIDATION_ERROR", "Missing 'lang' field", 400);

  if (file.size > 5 * 1024 * 1024) {
    return apiError("VALIDATION_ERROR", "File exceeds 5MB limit", 400);
  }

  // Verify language is configured
  const [langRow] = await sql`
    SELECT language_code FROM project_languages
    WHERE project_id = ${projectId} AND language_code = ${lang}
  `;
  if (!langRow) {
    return apiError("VALIDATION_ERROR", `Language '${lang}' is not configured for this project`, 400);
  }

  const fileContent = await file.text();

  const effectiveFormat = format || detectFormat(file.name);
  if (!effectiveFormat) {
    return apiError("VALIDATION_ERROR", "Could not detect file format. Specify 'format' field.", 400);
  }

  let parsed: Map<string, string>;
  try {
    parsed = parseFile(fileContent, effectiveFormat, lang);
  } catch (e: any) {
    return apiError("VALIDATION_ERROR", `Failed to parse file: ${e.message}`, 400);
  }

  // Find or create namespace
  let [ns] = await sql`
    SELECT id FROM namespaces
    WHERE project_id = ${projectId} AND name = ${namespaceName}
  `;
  if (!ns) {
    [ns] = await sql`
      INSERT INTO namespaces (project_id, name, sort_order)
      VALUES (${projectId}, ${namespaceName}, 0)
      RETURNING id
    `;
  }

  let created = 0;
  let updated = 0;
  const details: ChangeDetail[] = [];

  await sql.begin(async (tx) => {
    for (const [keyName, value] of parsed) {
      // Find or create key
      let [key] = await tx`
        SELECT id FROM translation_keys
        WHERE namespace_id = ${ns.id} AND key = ${keyName}
      `;
      if (!key) {
        [key] = await tx`
          INSERT INTO translation_keys (namespace_id, key)
          VALUES (${ns.id}, ${keyName})
          RETURNING id
        `;
      }

      // Upsert translation
      const [existing] = await tx`
        SELECT value FROM translations
        WHERE translation_key_id = ${key.id} AND language_code = ${lang}
      `;

      if (existing) {
        if (existing.value !== value) {
          await tx`
            UPDATE translations SET value = ${value}, updated_by = ${ctx.user.id}, updated_at = NOW()
            WHERE translation_key_id = ${key.id} AND language_code = ${lang}
          `;
          updated++;
          details.push({
            keyId: key.id, keyName, languageCode: lang,
            action: "updated", oldValue: existing.value, newValue: value,
          });
        }
      } else {
        await tx`
          INSERT INTO translations (translation_key_id, language_code, value, updated_by)
          VALUES (${key.id}, ${lang}, ${value}, ${ctx.user.id})
        `;
        created++;
        details.push({
          keyId: key.id, keyName, languageCode: lang,
          action: "created", oldValue: null, newValue: value,
        });
      }
    }

    if (details.length > 0) {
      const formatType = effectiveFormat.startsWith("json") ? "json" : effectiveFormat;
      await recordChange(tx, {
        orgId: ctx.org.id,
        projectId,
        userId: ctx.user.id,
        type: `import_${formatType}` as any,
        summary: `API: Imported ${details.length} translation(s) for [${lang}]`,
        details,
      });
    }
  });

  captureBusinessEvent("import_completed", ctx, { project_id: projectId, format: effectiveFormat, key_count: parsed.size });
  return apiSuccess({ created, updated, total: parsed.size });
}

function detectFormat(filename: string): FileFormat | null {
  if (filename.endsWith(".json")) return "json-nested";
  if (filename.endsWith(".csv")) return "csv";
  if (filename.endsWith(".yml") || filename.endsWith(".yaml")) return "yaml";
  return null;
}
