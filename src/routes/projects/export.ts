import type { AuthenticatedContext } from "../../types/index.ts";
import type { FileFormat } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { getSerializer, csv as csvFormat } from "../../lib/formats/index.ts";
import { buildXlsx } from "../../lib/formats/xlsx.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** Sanitize filename for Content-Disposition header */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

/** GET /projects/:id/export — export wizard page */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) return new Response("Not found", { status: 404 });

  const languages = await sql`
    SELECT * FROM project_languages WHERE project_id = ${project.id} ORDER BY language_code
  `;
  const namespaces = await sql`
    SELECT n.*,
      (SELECT COUNT(*) FROM translation_keys tk WHERE tk.namespace_id = n.id) AS key_count
    FROM namespaces n
    WHERE n.project_id = ${project.id}
    ORDER BY n.sort_order, n.name
  `;

  return render("pages/export.njk", { project, languages, namespaces, ctx, activePage: "projects" });
}

/** POST /projects/:id/export — download translations in selected format */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) return new Response("Not found", { status: 404 });

  const formData = await req.formData();
  const format = (formData.get("format") as FileFormat) || "json-nested";
  const namespaceIds = formData.getAll("namespaces[]") as string[];
  const languageCodes = formData.getAll("languages[]") as string[];
  const onlyMissing = formData.get("only_missing") === "1";

  // Backwards compat: if old-style single values passed
  const singleLang = formData.get("language") as string;
  const singleNs = formData.get("namespace") as string;
  if (singleLang && languageCodes.length === 0) languageCodes.push(singleLang);
  if (singleNs && namespaceIds.length === 0) namespaceIds.push(singleNs);

  const isMultiFormat = format === "csv" || format === "xlsx";
  const multiNamespace = namespaceIds.length > 1;

  // Build translations query
  const translations = await queryTranslations(project.id, namespaceIds, languageCodes);

  // Resolve namespace names for multi-namespace prefix (scoped to project)
  let nsNameMap = new Map<string, string>();
  if (multiNamespace) {
    const nsList = await sql`SELECT id, name FROM namespaces WHERE id IN ${sql(namespaceIds)} AND project_id = ${project.id}`;
    for (const ns of nsList) nsNameMap.set(ns.id, ns.name);
  }

  // Get first namespace name for filename (scoped to project)
  let nsName = "all";
  if (namespaceIds.length === 1) {
    const [ns] = await sql`SELECT name FROM namespaces WHERE id = ${namespaceIds[0]} AND project_id = ${project.id}`;
    nsName = ns?.name ?? "all";
  } else if (namespaceIds.length > 1) {
    nsName = "multi";
  }

  // Build output
  if (isMultiFormat) {
    // CSV/XLSX: multi-language table
    const langMap = buildMultiLangMap(translations, languageCodes, multiNamespace, nsNameMap);

    // Apply only-missing filter
    if (onlyMissing && languageCodes.length > 0) {
      filterOnlyMissing(langMap, languageCodes);
    }

    captureBusinessEvent("export_completed", ctx, { project_id: project.id, format });

    if (format === "xlsx") {
      const buffer = await buildXlsx(langMap, languageCodes);
      const filename = sanitizeFilename(`${nsName}_export`) + ".xlsx";
      return new Response(buffer, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } else {
      const output = csvFormat.serialize(langMap);
      const filename = sanitizeFilename(`${nsName}_export`) + ".csv";
      return new Response(output, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }
  } else {
    // JSON/YAML: single language
    const langCode = languageCodes[0] || "";
    if (!langCode) {
      return Response.redirect(`/projects/${project.id}/export`, 303);
    }

    const data = new Map<string, string>();
    for (const row of translations) {
      if (row.language_code === langCode && row.value) {
        const key = multiNamespace && nsNameMap.has(row.namespace_id)
          ? `${nsNameMap.get(row.namespace_id)}/${row.key}`
          : row.key;
        data.set(key, row.value);
      }
    }

    const serializer = getSerializer(format);
    const output = serializer(data);
    const contentType = format === "yaml" ? "application/x-yaml" : "application/json";
    const ext = format === "yaml" ? "yml" : "json";
    const filename = sanitizeFilename(`${nsName}_${langCode}`) + `.${ext}`;

    captureBusinessEvent("export_completed", ctx, { project_id: project.id, format });

    return new Response(output, {
      headers: {
        "Content-Type": `${contentType}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
}

// ─── Shared helpers ───

interface TranslationRow {
  key: string;
  language_code: string | null;
  value: string | null;
  namespace_id: string;
}

async function queryTranslations(
  projectId: string,
  namespaceIds: string[],
  languageCodes: string[],
): Promise<TranslationRow[]> {
  if (namespaceIds.length > 0 && languageCodes.length > 0) {
    return await sql`
      SELECT tk.key, t.language_code, t.value, tk.namespace_id
      FROM translation_keys tk
      JOIN namespaces n ON n.id = tk.namespace_id
      LEFT JOIN translations t ON t.translation_key_id = tk.id
        AND t.language_code IN ${sql(languageCodes)}
      WHERE n.project_id = ${projectId}
        AND n.id IN ${sql(namespaceIds)}
      ORDER BY tk.key
    `;
  } else if (namespaceIds.length > 0) {
    return await sql`
      SELECT tk.key, t.language_code, t.value, tk.namespace_id
      FROM translation_keys tk
      JOIN namespaces n ON n.id = tk.namespace_id
      LEFT JOIN translations t ON t.translation_key_id = tk.id
      WHERE n.project_id = ${projectId}
        AND n.id IN ${sql(namespaceIds)}
      ORDER BY tk.key
    `;
  } else if (languageCodes.length > 0) {
    return await sql`
      SELECT tk.key, t.language_code, t.value, tk.namespace_id
      FROM translation_keys tk
      JOIN namespaces n ON n.id = tk.namespace_id
      LEFT JOIN translations t ON t.translation_key_id = tk.id
        AND t.language_code IN ${sql(languageCodes)}
      WHERE n.project_id = ${projectId}
      ORDER BY tk.key
    `;
  } else {
    return await sql`
      SELECT tk.key, t.language_code, t.value, tk.namespace_id
      FROM translation_keys tk
      JOIN namespaces n ON n.id = tk.namespace_id
      LEFT JOIN translations t ON t.translation_key_id = tk.id
      WHERE n.project_id = ${projectId}
      ORDER BY tk.key
    `;
  }
}

function buildMultiLangMap(
  translations: TranslationRow[],
  languageCodes: string[],
  multiNamespace: boolean,
  nsNameMap: Map<string, string>,
): Map<string, Map<string, string>> {
  const langMap = new Map<string, Map<string, string>>();

  for (const row of translations) {
    if (!row.language_code) continue;
    if (!langMap.has(row.language_code)) langMap.set(row.language_code, new Map());
    const key = multiNamespace && nsNameMap.has(row.namespace_id)
      ? `${nsNameMap.get(row.namespace_id)}/${row.key}`
      : row.key;
    if (row.value) {
      langMap.get(row.language_code)!.set(key, row.value);
    }
  }

  // Ensure all selected languages exist in the map
  for (const lc of languageCodes) {
    if (!langMap.has(lc)) langMap.set(lc, new Map());
  }

  return langMap;
}

function filterOnlyMissing(
  langMap: Map<string, Map<string, string>>,
  languageCodes: string[],
): void {
  // Collect all keys
  const allKeys = new Set<string>();
  for (const lm of langMap.values()) {
    for (const k of lm.keys()) allKeys.add(k);
  }

  // Find keys where all selected languages have translations
  const keysToRemove: string[] = [];
  for (const key of allKeys) {
    const allPresent = languageCodes.every(lc => {
      const val = langMap.get(lc)?.get(key);
      return val !== undefined && val !== null && val !== "";
    });
    if (allPresent) keysToRemove.push(key);
  }

  // Remove fully-translated keys
  for (const key of keysToRemove) {
    for (const lm of langMap.values()) {
      lm.delete(key);
    }
  }
}

// ─── Preview data builder (used by export-preview route) ───

export interface PreviewResult {
  rows: Record<string, string>[];
  columns: string[];
  page: number;
  totalPages: number;
  totalRows: number;
}

export async function buildPreviewData(
  projectId: string,
  format: FileFormat,
  namespaceIds: string[],
  languageCodes: string[],
  onlyMissing: boolean,
  page: number,
  pageSize = 50,
): Promise<PreviewResult> {
  const translations = await queryTranslations(projectId, namespaceIds, languageCodes);

  const multiNamespace = namespaceIds.length > 1;
  let nsNameMap = new Map<string, string>();
  if (multiNamespace) {
    const nsList = await sql`SELECT id, name FROM namespaces WHERE id IN ${sql(namespaceIds)} AND project_id = ${projectId}`;
    for (const ns of nsList) nsNameMap.set(ns.id, ns.name);
  }

  const isMultiFormat = format === "csv" || format === "xlsx";

  if (isMultiFormat) {
    // Multi-language table: Key, lang1, lang2, ...
    const langMap = buildMultiLangMap(translations, languageCodes, multiNamespace, nsNameMap);

    if (onlyMissing && languageCodes.length > 0) {
      filterOnlyMissing(langMap, languageCodes);
    }

    const allKeys = new Set<string>();
    for (const lm of langMap.values()) {
      for (const k of lm.keys()) allKeys.add(k);
    }
    // Also collect keys that exist but have no translations (LEFT JOIN gave null language_code)
    // Skip when onlyMissing is active — filterOnlyMissing already pruned langMap,
    // and re-adding from raw results would bring back fully-translated keys with empty values.
    if (!onlyMissing) {
      for (const row of translations) {
        const key = multiNamespace && nsNameMap.has(row.namespace_id)
          ? `${nsNameMap.get(row.namespace_id)}/${row.key}`
          : row.key;
        allKeys.add(key);
      }
    }
    const sortedKeys = [...allKeys].sort();
    const langs = languageCodes.length > 0 ? languageCodes : [...langMap.keys()];
    const columns = ["Key", ...langs];

    const totalRows = sortedKeys.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * pageSize;
    const pageKeys = sortedKeys.slice(start, start + pageSize);

    const rows = pageKeys.map(key => {
      const row: Record<string, string> = { Key: key };
      for (const lang of langs) {
        row[lang] = langMap.get(lang)?.get(key) ?? "";
      }
      return row;
    });

    // If only-missing, also filter out fully translated from the key list for display
    // (already done above via filterOnlyMissing)

    return { rows, columns, page: safePage, totalPages, totalRows };
  } else {
    // Single-language: Key, Value
    const langCode = languageCodes[0] || "";
    const columns = ["Key", "Value"];

    const data: { key: string; value: string }[] = [];
    for (const row of translations) {
      if (row.language_code === langCode && row.value) {
        const key = multiNamespace && nsNameMap.has(row.namespace_id)
          ? `${nsNameMap.get(row.namespace_id)}/${row.key}`
          : row.key;
        data.push({ key, value: row.value });
      }
    }
    data.sort((a, b) => a.key.localeCompare(b.key));

    const totalRows = data.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * pageSize;
    const pageData = data.slice(start, start + pageSize);

    const rows = pageData.map(d => ({ Key: d.key, Value: d.value }));

    return { rows, columns, page: safePage, totalPages, totalRows };
  }
}
