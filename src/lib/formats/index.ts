import type { FileFormat } from "../../types/index.ts";
import * as jsonNested from "./json-nested.ts";
import * as jsonFlat from "./json-flat.ts";
import * as csv from "./csv.ts";
import * as yamlFormat from "./yaml.ts";
import * as xlsx from "./xlsx.ts";
export { detectFormat } from "./detect.ts";

/**
 * Parse a file into a flat Map<key, value> for a single language.
 * For CSV, extracts the specified language column.
 * For JSON/YAML, parses the entire file (already single-language).
 */
export function parseFile(
  content: string,
  format: FileFormat,
  language?: string,
): Map<string, string> {
  switch (format) {
    case "json-nested": return jsonNested.parse(content);
    case "json-flat": return jsonFlat.parse(content);
    case "yaml": return yamlFormat.parse(content);
    case "csv": return csv.parseSingleLanguage(content, language ?? "");
    case "xlsx": throw new Error("XLSX requires binary parsing — use parseXlsx() instead");
  }
}

/** Get serializer for a single-language format. Returns serialize(data) → string. */
export function getSerializer(format: FileFormat): (data: Map<string, string>) => string {
  switch (format) {
    case "json-nested": return jsonNested.serialize;
    case "json-flat": return jsonFlat.serialize;
    case "yaml": return yamlFormat.serialize;
    case "csv": throw new Error("Use csv.serialize() directly — CSV needs multi-language maps");
    case "xlsx": throw new Error("XLSX export not supported — use CSV or JSON");
  }
}

/**
 * Parse an XLSX file (binary) into Map<key, value> for a single language.
 */
export function parseXlsx(buffer: ArrayBuffer, language: string): Promise<Map<string, string>> {
  return xlsx.parseSingleLanguage(buffer, language);
}

/**
 * Parse a multi-language file (CSV or XLSX) into Map<language, Map<key, value>>.
 */
export async function parseMultiLanguage(
  format: FileFormat,
  content: string | ArrayBuffer,
): Promise<Map<string, Map<string, string>>> {
  if (format === "csv") return csv.parse(content as string);
  if (format === "xlsx") return xlsx.parse(content as ArrayBuffer);
  throw new Error(`Multi-language parsing not supported for ${format}`);
}

/**
 * Split keys on "/" into { namespace, key } pairs.
 * "common/info" → { namespace: "common", key: "info" }
 * "hello" (no slash) → { namespace: defaultNamespace, key: "hello" }
 */
export function splitKeyNamespace(
  fullKey: string,
  defaultNamespace: string,
): { namespace: string; key: string } {
  const slashIdx = fullKey.indexOf("/");
  if (slashIdx === -1) return { namespace: defaultNamespace, key: fullKey };
  return {
    namespace: fullKey.substring(0, slashIdx),
    key: fullKey.substring(slashIdx + 1),
  };
}

export { csv, xlsx };
