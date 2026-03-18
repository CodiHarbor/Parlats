import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import type { FileFormat } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiError } from "../../../lib/api-helpers.ts";
import { getSerializer, csv as csvFormat } from "../../../lib/formats/index.ts";
import { sanitizeFilename } from "../../../lib/validation.ts";

/** GET /api/v1/projects/:id/export — export translations */
export async function GET(_req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const projectId = ctx.params.id;

  const [project] = await sql`
    SELECT id, name FROM projects WHERE id = ${projectId} AND org_id = ${ctx.org.id}
  `;
  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  const format = (ctx.query.get("format") as FileFormat) || "json-nested";
  const lang = ctx.query.get("lang") || "";
  const namespace = ctx.query.get("namespace") || "";

  const validFormats = ["json-nested", "json-flat", "csv", "yaml"];
  if (!validFormats.includes(format)) {
    return apiError("VALIDATION_ERROR", `Invalid format. Use one of: ${validFormats.join(", ")}`, 400);
  }

  if (format !== "csv" && !lang) {
    return apiError("VALIDATION_ERROR", "Query parameter 'lang' is required for non-CSV formats", 400);
  }

  let translations;
  if (namespace) {
    translations = await sql`
      SELECT tk.key, t.language_code, t.value
      FROM translation_keys tk
      JOIN namespaces n ON n.id = tk.namespace_id
      LEFT JOIN translations t ON t.translation_key_id = tk.id
      WHERE n.project_id = ${projectId}
        AND n.name = ${namespace}
        ${lang ? sql`AND t.language_code = ${lang}` : sql``}
      ORDER BY tk.key
    `;
  } else {
    translations = await sql`
      SELECT tk.key, t.language_code, t.value
      FROM translation_keys tk
      JOIN namespaces n ON n.id = tk.namespace_id
      LEFT JOIN translations t ON t.translation_key_id = tk.id
      WHERE n.project_id = ${projectId}
        ${lang ? sql`AND t.language_code = ${lang}` : sql``}
      ORDER BY tk.key
    `;
  }

  let output: string;
  let contentType: string;
  let ext: string;

  if (format === "csv") {
    const langMap = new Map<string, Map<string, string>>();
    for (const row of translations) {
      if (!row.language_code || !row.value) continue;
      if (!langMap.has(row.language_code)) langMap.set(row.language_code, new Map());
      langMap.get(row.language_code)!.set(row.key, row.value);
    }
    output = csvFormat.serialize(langMap);
    contentType = "text/csv";
    ext = "csv";
  } else {
    const data = new Map<string, string>();
    for (const row of translations) {
      if (row.value) data.set(row.key, row.value);
    }
    const serializer = getSerializer(format);
    output = serializer(data);
    contentType = format === "yaml" ? "application/x-yaml" : "application/json";
    ext = format === "yaml" ? "yml" : "json";
  }

  const nsName = sanitizeFilename(namespace || "all");
  const filename = `${nsName}_${sanitizeFilename(lang || "all")}.${ext}`;

  return new Response(output, {
    headers: {
      "Content-Type": `${contentType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
