import type { FileFormat } from "../../types/index.ts";

/**
 * Auto-detect file format from extension and content.
 */
export function detectFormat(filename: string, content: string): FileFormat {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "csv") return "csv";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "yml" || ext === "yaml") return "yaml";

  // For .json or unknown extensions, analyze content
  try {
    const obj = JSON.parse(content);
    if (typeof obj === "object" && obj !== null) {
      for (const value of Object.values(obj)) {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          return "json-nested";
        }
      }
    }
  } catch {
    // Not valid JSON
  }

  return "json-flat";
}
