import type { AuthenticatedContext } from "../../types/index.ts";
import type { FileFormat } from "../../types/index.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";
import { sql } from "../../db/client.ts";
import { isValidImportToken, isValidUuid } from "../../lib/validation.ts";
import {
  parseFile,
  parseMultiLanguage,
  splitKeyNamespace,
} from "../../lib/formats/index.ts";
import { computeDiff, computeBulkDiff } from "../../lib/import-diff.ts";
import { unlink } from "node:fs/promises";

const TEMP_PREFIX = "/tmp/parlats-import-";
const DEFAULT_NAMESPACE = "default";

/** Map file format to change operation type */
function changeType(format: string): string {
  if (format.startsWith("json")) return "import_json";
  if (format === "csv") return "import_csv";
  if (format === "yaml") return "import_yaml";
  if (format === "xlsx") return "import_xlsx";
  return "import_json";
}

/** POST /projects/:id/import/apply-wizard — apply all new+changed entries */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) return new Response("Not found", { status: 404 });

  const formData = await req.formData();
  const token = formData.get("token") as string || "";
  const overrideNamespaceId = formData.get("namespace_id") as string || "";

  if (!token || !isValidImportToken(token)) {
    return Response.redirect(`/projects/${project.id}/import`, 303);
  }

  const tempPath = `${TEMP_PREFIX}${token}`;
  const metaPath = `${tempPath}.meta`;

  // Load metadata
  let meta: Record<string, any>;
  try {
    const metaFile = Bun.file(metaPath);
    if (!(await metaFile.exists())) {
      return Response.redirect(
        `/projects/${project.id}/import?error=${encodeURIComponent("Import session expired. Please upload the file again.")}`,
        303,
      );
    }
    meta = JSON.parse(await metaFile.text());
  } catch {
    return Response.redirect(
      `/projects/${project.id}/import?error=${encodeURIComponent("Import session expired.")}`,
      303,
    );
  }

  const format = meta.format as FileFormat;
  const isBulk = meta.isBulk as boolean;

  // Load file content
  const fileRef = Bun.file(tempPath);
  if (!(await fileRef.exists())) {
    return Response.redirect(
      `/projects/${project.id}/import?error=${encodeURIComponent("Import session expired.")}`,
      303,
    );
  }

  let appliedCount = 0;

  try {
    if (isBulk) {
      appliedCount = await applyBulkImport(fileRef, format, project, ctx);
    } else {
      // Use namespace from form data if provided (user picked from dropdown)
      if (overrideNamespaceId) {
        if (!isValidUuid(overrideNamespaceId)) {
          return Response.redirect(`/projects/${project.id}/import`, 303);
        }
        // Verify namespace belongs to this project
        const [nsCheck] = await sql`
          SELECT id FROM namespaces WHERE id = ${overrideNamespaceId} AND project_id = ${project.id}
        `;
        if (!nsCheck) {
          return Response.redirect(`/projects/${project.id}/import`, 303);
        }
        meta.namespaceId = overrideNamespaceId;
      }
      appliedCount = await applySingleImport(fileRef, format, meta, project, ctx);
    }
  } catch (err) {
    console.error("Import apply wizard error:", err);
    return Response.redirect(
      `/projects/${project.id}/import?error=${encodeURIComponent("Import failed. Please check your file and try again.")}`,
      303,
    );
  }

  // Clean up temp files
  try {
    await unlink(tempPath);
    await unlink(metaPath);
  } catch { /* ignore cleanup errors */ }

  captureBusinessEvent("import_completed", ctx, { project_id: project.id, format, key_count: appliedCount });

  return Response.redirect(
    `/projects/${project.id}/editor?imported=${appliedCount}`,
    303,
  );
}

async function applySingleImport(
  fileRef: ReturnType<typeof Bun.file>,
  format: FileFormat,
  meta: Record<string, any>,
  project: any,
  ctx: AuthenticatedContext,
): Promise<number> {
  const languageCode = meta.languageCode as string;
  const namespaceId = meta.namespaceId as string;
  const content = await fileRef.text();

  const incoming = parseFile(content, format, languageCode);

  // Get existing translations
  const existingRows = await sql`
    SELECT tk.key, t.value
    FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    LEFT JOIN translations t ON t.translation_key_id = tk.id AND t.language_code = ${languageCode}
    WHERE n.id = ${namespaceId} AND n.project_id = ${project.id}
  `;

  const existing = new Map<string, string>();
  for (const row of existingRows) {
    if (row.value !== null) existing.set(row.key, row.value);
  }

  const diff = computeDiff(incoming, existing);
  const changedRows = diff.filter(r => r.status === "new" || r.status === "changed");

  if (changedRows.length === 0) return 0;

  let createdCount = 0;
  let updatedCount = 0;

  await sql.begin(async (tx) => {
    // Create change_operation record
    const [operation] = await tx`
      INSERT INTO change_operations (org_id, project_id, user_id, type, summary, metadata)
      VALUES (
        ${ctx.org.id}, ${project.id}, ${ctx.user.id},
        ${changeType(format)},
        ${`Imported ${changedRows.length} translations for ${languageCode}`},
        ${JSON.stringify({ language: languageCode, format, keyCount: changedRows.length })}
      )
      RETURNING id
    `;

    for (const row of changedRows) {
      // Upsert translation key
      const [tk] = await tx`
        INSERT INTO translation_keys (namespace_id, key)
        VALUES (${namespaceId}, ${row.key})
        ON CONFLICT (namespace_id, key) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `;

      // Check for existing translation
      const [existingTx] = await tx`
        SELECT id, value FROM translations
        WHERE translation_key_id = ${tk.id} AND language_code = ${languageCode}
      `;

      const action = existingTx ? "updated" : "created";
      const oldValue = existingTx?.value ?? null;

      if (action === "created") createdCount++;
      else updatedCount++;

      // Upsert translation
      await tx`
        INSERT INTO translations (translation_key_id, language_code, value, updated_by)
        VALUES (${tk.id}, ${languageCode}, ${row.newValue}, ${ctx.user.id})
        ON CONFLICT (translation_key_id, language_code)
        DO UPDATE SET value = ${row.newValue}, updated_by = ${ctx.user.id}, updated_at = NOW()
      `;

      // Record change detail
      await tx`
        INSERT INTO change_details (operation_id, key_id, key_name, language_code, action, old_value, new_value)
        VALUES (${operation.id}, ${tk.id}, ${row.key}, ${languageCode}, ${action}, ${oldValue}, ${row.newValue})
      `;
    }
  });

  return createdCount + updatedCount;
}

async function applyBulkImport(
  fileRef: ReturnType<typeof Bun.file>,
  format: FileFormat,
  project: any,
  ctx: AuthenticatedContext,
): Promise<number> {
  let allLangs: Map<string, Map<string, string>>;
  if (format === "xlsx") {
    const buffer = await fileRef.arrayBuffer();
    allLangs = await parseMultiLanguage(format, buffer);
  } else {
    const content = await fileRef.text();
    allLangs = await parseMultiLanguage(format, content);
  }

  // Reorganize by namespace
  const byNamespace = new Map<string, Map<string, Map<string, string>>>();
  for (const [lang, keys] of allLangs) {
    for (const [rawKey, value] of keys) {
      const { namespace, key } = splitKeyNamespace(rawKey, DEFAULT_NAMESPACE);
      if (!byNamespace.has(namespace)) byNamespace.set(namespace, new Map());
      const nsMap = byNamespace.get(namespace)!;
      if (!nsMap.has(key)) nsMap.set(key, new Map());
      nsMap.get(key)!.set(lang, value);
    }
  }

  // Fetch existing translations
  const existingRows = await sql`
    SELECT n.name AS ns_name, tk.key, t.language_code, t.value
    FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    LEFT JOIN translations t ON t.translation_key_id = tk.id
    WHERE n.project_id = ${project.id}
  `;

  const existing = new Map<string, string>();
  for (const row of existingRows) {
    if (row.value !== null) {
      existing.set(`${row.ns_name}:${row.key}:${row.language_code}`, row.value);
    }
  }

  const diff = computeBulkDiff(byNamespace, existing);
  const changedRows = diff.filter(r => r.status === "new" || r.status === "changed");

  if (changedRows.length === 0) return 0;

  // Collect unique namespaces and languages
  const nsNames = [...new Set(changedRows.map(r => r.namespace))];
  const langCodes = [...new Set(changedRows.map(r => r.language))];

  let createdCount = 0;
  let updatedCount = 0;

  await sql.begin(async (tx) => {
    // Ensure all namespaces exist
    const nsIdMap = new Map<string, string>();
    const existingNs = await tx`
      SELECT id, name FROM namespaces WHERE project_id = ${project.id}
    `;
    for (const ns of existingNs) nsIdMap.set(ns.name, ns.id);

    let maxOrder = existingNs.length;
    for (const nsName of nsNames) {
      if (!nsIdMap.has(nsName)) {
        maxOrder++;
        const [created] = await tx`
          INSERT INTO namespaces (project_id, name, sort_order)
          VALUES (${project.id}, ${nsName}, ${maxOrder})
          ON CONFLICT (project_id, name) DO UPDATE SET name = namespaces.name
          RETURNING id
        `;
        nsIdMap.set(nsName, created.id);
      }
    }

    // Ensure all languages are added to project
    const existingLangs = await tx`
      SELECT language_code FROM project_languages WHERE project_id = ${project.id}
    `;
    const existingLangSet = new Set(existingLangs.map((l: any) => l.language_code));

    for (const lang of langCodes) {
      if (!existingLangSet.has(lang)) {
        await tx`
          INSERT INTO project_languages (project_id, language_code, label)
          VALUES (${project.id}, ${lang}, ${lang})
          ON CONFLICT DO NOTHING
        `;
      }
    }

    // Create change_operation record
    const [operation] = await tx`
      INSERT INTO change_operations (org_id, project_id, user_id, type, summary, metadata)
      VALUES (
        ${ctx.org.id}, ${project.id}, ${ctx.user.id},
        ${changeType(format)},
        ${`Bulk imported ${changedRows.length} translations across ${nsNames.length} namespace(s), ${langCodes.length} language(s)`},
        ${JSON.stringify({ format, cellCount: changedRows.length, namespaces: nsNames, languages: langCodes })}
      )
      RETURNING id
    `;

    // Upsert each changed row
    for (const row of changedRows) {
      const nsId = nsIdMap.get(row.namespace)!;

      // Upsert translation key
      const [tk] = await tx`
        INSERT INTO translation_keys (namespace_id, key)
        VALUES (${nsId}, ${row.key})
        ON CONFLICT (namespace_id, key) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `;

      // Check for existing translation
      const [existingTx] = await tx`
        SELECT id, value FROM translations
        WHERE translation_key_id = ${tk.id} AND language_code = ${row.language}
      `;

      const action = existingTx ? "updated" : "created";
      const oldValue = existingTx?.value ?? null;

      if (action === "created") createdCount++;
      else updatedCount++;

      // Upsert translation
      await tx`
        INSERT INTO translations (translation_key_id, language_code, value, updated_by)
        VALUES (${tk.id}, ${row.language}, ${row.newValue}, ${ctx.user.id})
        ON CONFLICT (translation_key_id, language_code)
        DO UPDATE SET value = ${row.newValue}, updated_by = ${ctx.user.id}, updated_at = NOW()
      `;

      // Record change detail
      await tx`
        INSERT INTO change_details (operation_id, key_id, key_name, language_code, action, old_value, new_value)
        VALUES (${operation.id}, ${tk.id}, ${row.key}, ${row.language}, ${action}, ${oldValue}, ${row.newValue})
      `;
    }
  });

  return createdCount + updatedCount;
}
