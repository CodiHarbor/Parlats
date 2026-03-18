import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** Map file format to change operation type */
function changeType(format: string): string {
  if (format.startsWith("json")) return "import_json";
  if (format === "csv") return "import_csv";
  if (format === "yaml") return "import_yaml";
  if (format === "xlsx") return "import_xlsx";
  return "import_json";
}

/** POST /projects/:id/import/apply — apply checked import rows in transaction */
export async function POST(
  req: Request,
  ctx: AuthenticatedContext,
): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) return new Response("Not found", { status: 404 });

  const formData = await req.formData();
  const selectedKeys = formData.getAll("keys[]") as string[];
  const languageCode = (formData.get("language") as string) || "";
  const namespaceId = (formData.get("namespace") as string) || "";
  const format = (formData.get("format") as string) || "json-nested";

  if (selectedKeys.length === 0 || !languageCode || !namespaceId) {
    return Response.redirect(`/projects/${project.id}/import`, 303);
  }

  // Verify namespace belongs to project
  const [ns] = await sql`
    SELECT id FROM namespaces WHERE id = ${namespaceId} AND project_id = ${project.id}
  `;
  if (!ns) return Response.redirect(`/projects/${project.id}/import`, 303);

  // Build key→value map from form hidden fields
  const keyValues = new Map<string, string>();
  for (const key of selectedKeys) {
    const value = formData.get(`data[${key}]`) as string;
    if (value !== null) keyValues.set(key, value);
  }

  if (keyValues.size === 0) {
    return Response.redirect(`/projects/${project.id}/import`, 303);
  }

  let createdCount = 0;
  let updatedCount = 0;

  // Single transaction: upsert keys + translations, record change history
  try {
  await sql.begin(async (tx) => {
    // Create change_operation record
    const [operation] = await tx`
      INSERT INTO change_operations (org_id, project_id, user_id, type, summary, metadata)
      VALUES (
        ${ctx.org.id}, ${project.id}, ${ctx.user.id},
        ${changeType(format)},
        ${`Imported ${keyValues.size} translations for ${languageCode}`},
        ${JSON.stringify({ language: languageCode, format, keyCount: keyValues.size })}
      )
      RETURNING id
    `;

    for (const [key, value] of keyValues) {
      // Upsert translation key
      const [tk] = await tx`
        INSERT INTO translation_keys (namespace_id, key)
        VALUES (${namespaceId}, ${key})
        ON CONFLICT (namespace_id, key) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `;

      // Check for existing translation
      const [existing] = await tx`
        SELECT id, value FROM translations
        WHERE translation_key_id = ${tk.id} AND language_code = ${languageCode}
      `;

      const action = existing ? "updated" : "created";
      const oldValue = existing?.value ?? null;

      if (action === "created") createdCount++;
      else updatedCount++;

      // Upsert translation
      await tx`
        INSERT INTO translations (translation_key_id, language_code, value, updated_by)
        VALUES (${tk.id}, ${languageCode}, ${value}, ${ctx.user.id})
        ON CONFLICT (translation_key_id, language_code)
        DO UPDATE SET value = ${value}, updated_by = ${ctx.user.id}, updated_at = NOW()
      `;

      // Record change detail
      await tx`
        INSERT INTO change_details (operation_id, key_id, key_name, language_code, action, old_value, new_value)
        VALUES (${operation.id}, ${tk.id}, ${key}, ${languageCode}, ${action}, ${oldValue}, ${value})
      `;
    }
  });
  } catch (err) {
    console.error("Import apply error:", err);
    return Response.redirect(
      `/projects/${project.id}/import?error=${encodeURIComponent("Import failed. Please check your file and try again.")}`,
      303,
    );
  }

  captureBusinessEvent("import_completed", ctx, { project_id: project.id, format, key_count: createdCount + updatedCount });

  // Redirect to editor with success message via query param
  return Response.redirect(
    `/projects/${project.id}/editor?namespace=${namespaceId}&imported=${createdCount + updatedCount}`,
    303,
  );
}
