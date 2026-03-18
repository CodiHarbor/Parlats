import Papa from "papaparse";
import { normalizeLanguageCode } from "../language-codes.ts";

/**
 * Parse CSV into Map<language, Map<key, value>>.
 * First column = key, remaining columns = language codes from header.
 */
export function parse(content: string): Map<string, Map<string, string>> {
  const parsed = Papa.parse(content.trim(), { header: false, skipEmptyLines: true });
  const rows = parsed.data as string[][];

  if (rows.length === 0) return new Map();

  const header = rows[0];
  const languages = header.slice(1).map((h) => normalizeLanguageCode(h));
  const result = new Map<string, Map<string, string>>();

  for (const lang of languages) {
    if (!result.has(lang)) result.set(lang, new Map());
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const key = row[0];
    if (!key) continue;

    for (let j = 0; j < languages.length; j++) {
      const value = row[j + 1] ?? "";
      result.get(languages[j])!.set(key, value);
    }
  }

  return result;
}

/**
 * Extract a single language from a CSV file.
 * Returns Map<key, value> for the specified language.
 */
export function parseSingleLanguage(content: string, language: string): Map<string, string> {
  const all = parse(content);
  return all.get(language) ?? new Map();
}

/** Escape values that spreadsheet apps interpret as formulas */
function escapeFormulaInjection(value: string): string {
  if (value.length > 0 && "=+-@\t\r".includes(value[0])) {
    return "'" + value;
  }
  return value;
}

/**
 * Serialize Map<language, Map<key, value>> into CSV.
 * First column = key, remaining columns = language codes.
 */
export function serialize(data: Map<string, Map<string, string>>): string {
  const languages = [...data.keys()];
  if (languages.length === 0) return "";

  const allKeys = new Set<string>();
  for (const langMap of data.values()) {
    for (const key of langMap.keys()) {
      allKeys.add(key);
    }
  }

  const keys = [...allKeys].sort();
  const rows: string[][] = [["key", ...languages]];

  for (const key of keys) {
    const row = [escapeFormulaInjection(key)];
    for (const lang of languages) {
      row.push(escapeFormulaInjection(data.get(lang)?.get(key) ?? ""));
    }
    rows.push(row);
  }

  return Papa.unparse(rows, { newline: "\n" }) + "\n";
}
