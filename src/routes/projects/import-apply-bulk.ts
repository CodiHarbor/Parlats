import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** Map file format to change operation type */
function changeType(format: string): string {
  if (format === "csv") return "import_csv";
  if (format === "xlsx") return "import_xlsx";
  return "import_json";
}

/** POST /projects/:id/import/apply-bulk — apply multi-language, multi-namespace import */
export async function POST(
  req: Request,
  ctx: AuthenticatedContext,
): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) return new Response("Not found", { status: 404 });

  const formData = await req.formData();
  const selectedCells = formData.getAll("cells[]") as string[];
  const format = (formData.get("format") as string) || "xlsx";

  if (selectedCells.length === 0) {
    return Response.redirect(`/projects/${project.id}/import`, 303);
  }

  // Parse cell selections: "namespace|key|language" → { ns, key, lang, value }
  const cells: Array<{ ns: string; key: string; lang: string; value: string }> = [];
  for (const cell of selectedCells) {
    const value = formData.get(`data[${cell}]`) as string;
    if (value === null) continue;
    const [ns, key, lang] = cell.split("|");
    cells.push({ ns, key, lang, value });
  }

  if (cells.length === 0) {
    return Response.redirect(`/projects/${project.id}/import`, 303);
  }

  // Collect unique namespaces and languages
  const nsNames = [...new Set(cells.map(c => c.ns))];
  const langCodes = [...new Set(cells.map(c => c.lang))];

  let createdCount = 0;
  let updatedCount = 0;

  try {
  await sql.begin(async (tx) => {
    // Ensure all namespaces exist
    const nsIdMap = new Map<string, string>();
    const existingNs = await tx`
      SELECT id, name FROM namespaces WHERE project_id = ${project.id}
    `;
    for (const ns of existingNs) nsIdMap.set(ns.name, ns.id);

    // Get max sort order for new namespaces
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
        ${`Bulk imported ${cells.length} translations across ${nsNames.length} namespace(s), ${langCodes.length} language(s)`},
        ${JSON.stringify({ format, cellCount: cells.length, namespaces: nsNames, languages: langCodes })}
      )
      RETURNING id
    `;

    // Upsert each cell
    for (const { ns, key, lang, value } of cells) {
      const nsId = nsIdMap.get(ns)!;

      // Upsert translation key
      const [tk] = await tx`
        INSERT INTO translation_keys (namespace_id, key)
        VALUES (${nsId}, ${key})
        ON CONFLICT (namespace_id, key) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `;

      // Check for existing translation
      const [existing] = await tx`
        SELECT id, value FROM translations
        WHERE translation_key_id = ${tk.id} AND language_code = ${lang}
      `;

      const action = existing ? "updated" : "created";
      const oldValue = existing?.value ?? null;

      if (action === "created") createdCount++;
      else updatedCount++;

      // Upsert translation
      await tx`
        INSERT INTO translations (translation_key_id, language_code, value, updated_by)
        VALUES (${tk.id}, ${lang}, ${value}, ${ctx.user.id})
        ON CONFLICT (translation_key_id, language_code)
        DO UPDATE SET value = ${value}, updated_by = ${ctx.user.id}, updated_at = NOW()
      `;

      // Record change detail
      await tx`
        INSERT INTO change_details (operation_id, key_id, key_name, language_code, action, old_value, new_value)
        VALUES (${operation.id}, ${tk.id}, ${key}, ${lang}, ${action}, ${oldValue}, ${value})
      `;
    }
  });
  } catch (err) {
    console.error("Bulk import error:", err);
    return Response.redirect(
      `/projects/${project.id}/import?error=${encodeURIComponent((err as Error).message || "Import failed")}`,
      303,
    );
  }

  captureBusinessEvent("import_completed", ctx, { project_id: project.id, format, key_count: createdCount + updatedCount });

  return Response.redirect(
    `/projects/${project.id}/editor?imported=${createdCount + updatedCount}`,
    303,
  );
}
