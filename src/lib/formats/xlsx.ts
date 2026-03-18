import ExcelJS from "exceljs";
import { normalizeLanguageCode } from "../language-codes.ts";

/**
 * Parse XLSX buffer into Map<language, Map<key, value>>.
 * First column = key, remaining columns = language codes.
 */
export async function parse(buffer: ArrayBuffer): Promise<Map<string, Map<string, string>>> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer));
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) return new Map();

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  // Detect if first column is context/notes
  const keyColIndex = isContextHeader(headers[1]) ? 2 : 1;
  const langStartIndex = keyColIndex + 1;

  const languages: string[] = [];
  for (let i = langStartIndex; i <= Object.keys(headers).length; i++) {
    if (headers[i]) languages.push(normalizeLanguageCode(headers[i]));
  }

  const result = new Map<string, Map<string, string>>();
  for (const lang of languages) {
    if (!result.has(lang)) result.set(lang, new Map());
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const key = String(row.getCell(keyColIndex).value ?? "").trim();
    if (!key) return;

    for (let j = 0; j < languages.length; j++) {
      const value = String(row.getCell(langStartIndex + j).value ?? "");
      result.get(languages[j])!.set(key, value);
    }
  });

  return result;
}

/**
 * Extract a single language from an XLSX file.
 */
export async function parseSingleLanguage(
  buffer: ArrayBuffer,
  language: string,
): Promise<Map<string, string>> {
  const all = await parse(buffer);
  if (all.has(language)) return all.get(language)!;
  for (const [lang, map] of all) {
    if (lang.toLowerCase().includes(language.toLowerCase())) return map;
  }
  if (all.size === 1) return all.values().next().value!;
  return new Map();
}

/**
 * Build an XLSX buffer from a multi-language map.
 */
export async function buildXlsx(
  langMap: Map<string, Map<string, string>>,
  languageCodes: string[],
): Promise<ArrayBuffer> {
  const allKeys = new Set<string>();
  for (const lm of langMap.values()) {
    for (const k of lm.keys()) allKeys.add(k);
  }
  const sortedKeys = [...allKeys].sort();
  const langs = languageCodes.length > 0 ? languageCodes : [...langMap.keys()];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Translations");

  // Header row
  sheet.addRow(["Key", ...langs]);

  // Data rows
  for (const key of sortedKeys) {
    const row = [key];
    for (const lang of langs) {
      row.push(langMap.get(lang)?.get(key) ?? "");
    }
    sheet.addRow(row);
  }

  const nodeBuffer = await workbook.xlsx.writeBuffer();
  return nodeBuffer as ArrayBuffer;
}

const CONTEXT_HEADERS = new Set([
  "context", "note", "notes", "comment", "comments",
  "description", "group", "category", "module", "section",
]);

function isContextHeader(value: string | undefined): boolean {
  if (!value) return false;
  return CONTEXT_HEADERS.has(value.trim().toLowerCase());
}
