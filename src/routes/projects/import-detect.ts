import type { AuthenticatedContext } from "../../types/index.ts";
import type { FileFormat } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import {
  parseFile,
  parseMultiLanguage,
  splitKeyNamespace,
  detectFormat,
} from "../../lib/formats/index.ts";
import { computeDiff, computeBulkDiff } from "../../lib/import-diff.ts";
import { readdir, unlink, stat } from "node:fs/promises";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMPORT_KEYS = 10_000;
const DEFAULT_NAMESPACE = "default";
const TEMP_PREFIX = "/tmp/parlats-import-";

/** Clean up temp files older than 1 hour */
async function cleanupOldTempFiles(): Promise<void> {
  try {
    const files = await readdir("/tmp");
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    for (const f of files) {
      if (!f.startsWith("parlats-import-")) continue;
      try {
        const fpath = `/tmp/${f}`;
        const s = await stat(fpath);
        if (now - s.mtimeMs > oneHour) {
          await unlink(fpath);
        }
      } catch { /* ignore individual file errors */ }
    }
  } catch { /* ignore cleanup errors */ }
}

/**
 * Try to extract language code from filename.
 * Patterns: en.json, messages_de.json, translations-fr.yaml, etc.
 */
function detectLanguageFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, ""); // strip extension
  // Exact match: en, de, fr, ja, etc.
  if (/^[a-z]{2}(-[A-Za-z]{2,})?$/.test(base)) return base;
  // Suffix: messages_en, translations-de
  const suffixMatch = base.match(/[_-]([a-z]{2}(?:-[A-Za-z]{2,})?)$/);
  if (suffixMatch && suffixMatch[1]) return suffixMatch[1];
  return null;
}

/**
 * Try to detect namespace from filename.
 * Patterns: common.json → "common", auth.yaml → "auth"
 * Returns null if the base name looks like a language code.
 */
function detectNamespaceFromFilename(filename: string, namespacesInProject: string[]): string | null {
  const base = filename.replace(/\.[^.]+$/, ""); // strip extension
  // Don't treat language codes as namespace names
  if (/^[a-z]{2}(-[A-Za-z]{2,})?$/.test(base)) return null;
  // Check if the base name (case-insensitive) matches a project namespace
  const match = namespacesInProject.find(ns => ns.toLowerCase() === base.toLowerCase());
  return match ?? null;
}

/** POST /projects/:id/import/detect — detect format and compute diff */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) return new Response("Not found", { status: 404 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file || !file.name) {
    return render("partials/import-step-detect.njk", {
      error: "Please select a file to upload.",
      project,
      ctx,
    });
  }

  if (file.size > MAX_FILE_SIZE) {
    return render("partials/import-step-detect.njk", {
      error: "File too large. Maximum size is 5MB.",
      project,
      ctx,
    });
  }

  // Clean up old temp files (fire and forget)
  cleanupOldTempFiles();

  // Detect format
  let format: FileFormat;
  let textContent: string | null = null;
  let binaryContent: ArrayBuffer | null = null;

  const extFormat = detectFormat(file.name, "");
  if (extFormat === "xlsx") {
    format = "xlsx";
    binaryContent = await file.arrayBuffer();
  } else {
    textContent = await file.text();
    format = detectFormat(file.name, textContent);
  }

  // Determine if bulk mode (CSV/XLSX → multi-language)
  const isBulk = format === "csv" || format === "xlsx";

  // Save file to temp location
  const token = crypto.randomUUID();
  const tempPath = `${TEMP_PREFIX}${token}`;

  if (binaryContent) {
    await Bun.write(tempPath, binaryContent);
  } else {
    await Bun.write(tempPath, textContent!);
  }

  // Also save metadata alongside the file
  const metaPath = `${tempPath}.meta`;
  const meta: Record<string, unknown> = {
    format,
    isBulk,
    filename: file.name,
    projectId: project.id,
    orgId: ctx.org.id,
    createdAt: Date.now(),
  };

  if (isBulk) {
    // Bulk: multi-language import
    let allLangs: Map<string, Map<string, string>>;
    try {
      if (format === "xlsx") {
        allLangs = await parseMultiLanguage(format, binaryContent!);
      } else {
        allLangs = await parseMultiLanguage(format, textContent!);
      }
    } catch (err) {
      return render("partials/import-step-detect.njk", {
        error: `Failed to parse file: ${(err as Error).message}`,
        project,
        ctx,
      });
    }

    if (allLangs.size === 0) {
      return render("partials/import-step-detect.njk", {
        error: "No language columns found in file.",
        project,
        ctx,
      });
    }

    // Count unique keys across all languages
    const uniqueKeys = new Set<string>();
    for (const keys of allLangs.values()) {
      for (const key of keys.keys()) uniqueKeys.add(key);
    }
    if (uniqueKeys.size > MAX_IMPORT_KEYS) {
      return render("partials/import-step-detect.njk", {
        error: `File contains ${uniqueKeys.size.toLocaleString()} keys, which exceeds the limit of ${MAX_IMPORT_KEYS.toLocaleString()}.`,
        project,
        ctx,
      });
    }

    // Reorganize: Map<namespace, Map<key, Map<language, value>>>
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

    // Fetch all existing translations for this project
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
    const newCount = diff.filter(r => r.status === "new").length;
    const changedCount = diff.filter(r => r.status === "changed").length;
    const unchangedCount = diff.filter(r => r.status === "unchanged").length;

    const detectedLanguages = [...allLangs.keys()];
    const detectedNamespaces = [...byNamespace.keys()].sort();

    meta.detectedLanguages = detectedLanguages;
    meta.detectedNamespaces = detectedNamespaces;
    await Bun.write(metaPath, JSON.stringify(meta));

    return render("partials/import-step-detect.njk", {
      detectedFormat: format,
      detectedLanguages,
      detectedNamespaces,
      newCount,
      changedCount,
      unchangedCount,
      totalEntries: diff.length,
      isBulk: true,
      project,
      token,
      ctx,
    });
  } else {
    // Single-language mode (JSON/YAML)
    // Detect language from filename, fall back to project default
    let languageCode = detectLanguageFromFilename(file.name);

    // Get project languages and default language
    const languages = await sql`
      SELECT language_code FROM project_languages WHERE project_id = ${project.id}
    `;
    const languageCodes = languages.map((l: any) => l.language_code);

    if (languageCode && !languageCodes.includes(languageCode)) {
      // Detected code not in project — fall back to default
      languageCode = null;
    }

    if (!languageCode) {
      languageCode = (project.default_language || languageCodes[0] || "en") as string;
    }

    // Get all namespaces for namespace picker
    const allNamespaces = await sql`
      SELECT id, name FROM namespaces WHERE project_id = ${project.id} ORDER BY sort_order, name
    `;
    const namespaceNames = allNamespaces.map((ns: any) => ns.name);

    // Detect namespace from filename (e.g., common.json → "common")
    const detectedNsName = detectNamespaceFromFilename(file.name, namespaceNames);

    // Determine selected namespace: detected from filename > project default > first
    let namespaceId: string | null = null;
    let namespaceName = DEFAULT_NAMESPACE;

    if (detectedNsName) {
      const match = allNamespaces.find((ns: any) => ns.name === detectedNsName);
      if (match) {
        namespaceId = match.id;
        namespaceName = match.name;
      }
    }

    if (!namespaceId && project.default_namespace_id) {
      const match = allNamespaces.find((ns: any) => ns.id === project.default_namespace_id);
      if (match) {
        namespaceId = match.id;
        namespaceName = match.name;
      }
    }

    if (!namespaceId && allNamespaces.length > 0) {
      namespaceId = allNamespaces[0].id;
      namespaceName = allNamespaces[0].name;
    }

    // Parse the file
    let incoming: Map<string, string>;
    try {
      incoming = parseFile(textContent!, format, languageCode!);
    } catch (err) {
      return render("partials/import-step-detect.njk", {
        error: `Failed to parse file: ${(err as Error).message}`,
        project,
        ctx,
      });
    }

    if (incoming.size > MAX_IMPORT_KEYS) {
      return render("partials/import-step-detect.njk", {
        error: `File contains ${incoming.size.toLocaleString()} keys, which exceeds the limit of ${MAX_IMPORT_KEYS.toLocaleString()}.`,
        project,
        ctx,
      });
    }

    // Get existing translations for this namespace + language
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
    const newCount = diff.filter(r => r.status === "new").length;
    const changedCount = diff.filter(r => r.status === "changed").length;
    const unchangedCount = diff.filter(r => r.status === "unchanged").length;

    meta.languageCode = languageCode;
    meta.namespaceId = namespaceId;
    meta.namespaceName = namespaceName;
    await Bun.write(metaPath, JSON.stringify(meta));

    return render("partials/import-step-detect.njk", {
      detectedFormat: format,
      detectedLanguages: [languageCode],
      detectedNamespaces: [namespaceName],
      newCount,
      changedCount,
      unchangedCount,
      totalEntries: diff.length,
      isBulk: false,
      allNamespaces,
      selectedNamespaceId: namespaceId,
      project,
      token,
      ctx,
    });
  }
}
