import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { isValidUuid } from "../../lib/validation.ts";
import { paginationWindow } from "../../lib/pagination.ts";

const PAGE_SIZE = 50;

/** GET /projects/:id/editor/keys — HTMX partial: key listing table */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT id, interpolation_format, default_language, default_namespace_id FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(req.url);
  const namespaceId = url.searchParams.get("namespace") || "";

  // Validate namespace is a UUID and belongs to this project
  if (!namespaceId || !isValidUuid(namespaceId)) {
    return new Response("Invalid namespace", { status: 400 });
  }

  const [nsCheck] = await sql`
    SELECT id FROM namespaces WHERE id = ${namespaceId} AND project_id = ${project.id}
  `;
  if (!nsCheck) {
    return new Response("Namespace not found", { status: 404 });
  }

  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const search = (url.searchParams.get("search") || "").trim();
  const missing = (url.searchParams.get("missing") || "").trim();
  const offset = (page - 1) * PAGE_SIZE;
  const pattern = `%${search}%`;

  const languages = await sql`
    SELECT * FROM project_languages
    WHERE project_id = ${project.id}
    ORDER BY CASE WHEN language_code = ${project.default_language} THEN 0 ELSE 1 END, language_code
  `;

  // Count filtered keys
  const [{ count }] = await sql`
    SELECT COUNT(DISTINCT tk.id) AS count
    FROM translation_keys tk
    WHERE tk.namespace_id = ${namespaceId}
      AND CASE WHEN ${search} = '' THEN TRUE
          ELSE tk.key ILIKE ${pattern} OR EXISTS (
            SELECT 1 FROM translations ts
            WHERE ts.translation_key_id = tk.id AND ts.value ILIKE ${pattern}
          ) END
      AND CASE WHEN ${missing} = '' THEN TRUE
          ELSE NOT EXISTS (
            SELECT 1 FROM translations tm
            WHERE tm.translation_key_id = tk.id
              AND tm.language_code = ${missing}
              AND tm.value IS NOT NULL AND tm.value != ''
          ) END
  `;
  const totalKeys = Number(count);

  // Get filtered keys for this page
  const keys = await sql`
    SELECT DISTINCT tk.id, tk.key, tk.description
    FROM translation_keys tk
    WHERE tk.namespace_id = ${namespaceId}
      AND CASE WHEN ${search} = '' THEN TRUE
          ELSE tk.key ILIKE ${pattern} OR EXISTS (
            SELECT 1 FROM translations ts
            WHERE ts.translation_key_id = tk.id AND ts.value ILIKE ${pattern}
          ) END
      AND CASE WHEN ${missing} = '' THEN TRUE
          ELSE NOT EXISTS (
            SELECT 1 FROM translations tm
            WHERE tm.translation_key_id = tk.id
              AND tm.language_code = ${missing}
              AND tm.value IS NOT NULL AND tm.value != ''
          ) END
    ORDER BY tk.key
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;

  const totalPages = Math.max(1, Math.ceil(totalKeys / PAGE_SIZE));

  // Get translations for these keys
  const keyIds = keys.map((k: { id: string }) => k.id);
  let translations: any[] = [];
  if (keyIds.length > 0) {
    translations = await sql`
      SELECT id, translation_key_id, language_code, value
      FROM translations
      WHERE translation_key_id IN ${sql(keyIds)}
    `;
  }

  // Get comment counts per key
  let commentCounts: Record<string, number> = {};
  if (keyIds.length > 0) {
    const counts = await sql`
      SELECT translation_key_id, COUNT(*)::int AS count
      FROM comments
      WHERE translation_key_id IN ${sql(keyIds)}
      GROUP BY translation_key_id
    `;
    for (const c of counts) {
      commentCounts[c.translation_key_id] = c.count;
    }
  }

  // Group translations by key_id → { langCode: { id, value } }
  const translationMap: Record<string, Record<string, { id: string; value: string }>> = {};
  for (const t of translations) {
    if (!translationMap[t.translation_key_id]) {
      translationMap[t.translation_key_id] = {};
    }
    translationMap[t.translation_key_id][t.language_code] = {
      id: t.id,
      value: t.value,
    };
  }

  // Per-namespace key counts (for tab badges, filtered by current search/missing)
  const namespaceCounts = await sql`
    SELECT n.id AS namespace_id, COUNT(DISTINCT tk.id)::int AS count
    FROM namespaces n
    LEFT JOIN translation_keys tk ON tk.namespace_id = n.id
      AND CASE WHEN ${search} = '' THEN TRUE
          ELSE tk.key ILIKE ${pattern} OR EXISTS (
            SELECT 1 FROM translations ts
            WHERE ts.translation_key_id = tk.id AND ts.value ILIKE ${pattern}
          ) END
      AND CASE WHEN ${missing} = '' THEN TRUE
          ELSE NOT EXISTS (
            SELECT 1 FROM translations tm
            WHERE tm.translation_key_id = tk.id
              AND tm.language_code = ${missing}
              AND tm.value IS NOT NULL AND tm.value != ''
          ) END
    WHERE n.project_id = ${project.id}
    GROUP BY n.id
  `;
  const nsCounts: Record<string, number> = {};
  for (const row of namespaceCounts) {
    nsCounts[row.namespace_id] = row.count;
  }

  return render("partials/editor-keys.njk", {
    project,
    keys,
    languages,
    translationMap,
    commentCounts,
    namespaceId,
    page,
    totalPages,
    totalKeys,
    search,
    missing,
    pageWindow: paginationWindow(page, totalPages),
    nsCounts,
    ctx,
  });
}
