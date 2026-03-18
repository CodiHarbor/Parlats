import type { AuthenticatedContext } from "../../types/index.ts";
import type { FileFormat } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { isValidImportToken } from "../../lib/validation.ts";
import { sql } from "../../db/client.ts";
import {
  parseFile,
  parseMultiLanguage,
  splitKeyNamespace,
} from "../../lib/formats/index.ts";
import { computeDiff, computeBulkDiff } from "../../lib/import-diff.ts";

const TEMP_PREFIX = "/tmp/parlats-import-";
const PAGE_SIZE = 50;
const DEFAULT_NAMESPACE = "default";

/** GET /projects/:id/import/preview — paginated preview of changes */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) return new Response("Not found", { status: 404 });

  const token = ctx.query.get("token") || "";
  const page = Math.max(1, parseInt(ctx.query.get("page") || "1", 10));

  if (!token || !isValidImportToken(token)) {
    return render("partials/import-step-preview.njk", {
      error: "Invalid preview token.",
      project,
      ctx,
    });
  }

  const tempPath = `${TEMP_PREFIX}${token}`;
  const metaPath = `${tempPath}.meta`;

  // Load metadata
  let meta: Record<string, any>;
  try {
    const metaFile = Bun.file(metaPath);
    if (!(await metaFile.exists())) {
      return render("partials/import-step-preview.njk", {
        error: "Import session expired. Please upload the file again.",
        project,
        ctx,
      });
    }
    meta = JSON.parse(await metaFile.text());
  } catch {
    return render("partials/import-step-preview.njk", {
      error: "Import session expired. Please upload the file again.",
      project,
      ctx,
    });
  }

  const format = meta.format as FileFormat;
  const isBulk = meta.isBulk as boolean;

  // Load file content
  const fileRef = Bun.file(tempPath);
  if (!(await fileRef.exists())) {
    return render("partials/import-step-preview.njk", {
      error: "Import session expired. Please upload the file again.",
      project,
      ctx,
    });
  }

  // Compute diff (re-parse)
  let changedRows: Array<{
    key: string;
    namespace?: string;
    language?: string;
    status: string;
    oldValue: string | null;
    newValue: string;
  }> = [];

  if (isBulk) {
    let allLangs: Map<string, Map<string, string>>;
    if (format === "xlsx") {
      const buffer = await fileRef.arrayBuffer();
      allLangs = await parseMultiLanguage(format, buffer);
    } else {
      const content = await fileRef.text();
      allLangs = await parseMultiLanguage(format, content);
    }

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
    changedRows = diff
      .filter(r => r.status === "new" || r.status === "changed")
      .map(r => ({
        key: r.key,
        namespace: r.namespace,
        language: r.language,
        status: r.status,
        oldValue: r.oldValue,
        newValue: r.newValue,
      }));
  } else {
    const languageCode = meta.languageCode as string;
    const namespaceId = meta.namespaceId as string;
    const namespaceName = meta.namespaceName as string;
    const content = await fileRef.text();

    const incoming = parseFile(content, format, languageCode);

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
    changedRows = diff
      .filter(r => r.status === "new" || r.status === "changed")
      .map(r => ({
        key: r.key,
        language: languageCode,
        namespace: namespaceName,
        status: r.status,
        oldValue: r.oldValue,
        newValue: r.newValue,
      }));
  }

  // Paginate
  const totalRows = changedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = changedRows.slice(start, start + PAGE_SIZE);

  return render("partials/import-step-preview.njk", {
    rows: pageRows,
    page: currentPage,
    totalPages,
    totalRows,
    isBulk,
    project,
    token,
    ctx,
  });
}
