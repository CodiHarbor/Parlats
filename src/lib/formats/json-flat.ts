/**
 * Parse flat JSON into a Map<key, value>.
 * Only top-level string values are included. Nested objects are skipped.
 */
export function parse(content: string): Map<string, string> {
  const obj = JSON.parse(content);
  const result = new Map<string, string>();

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result.set(key, value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      result.set(key, String(value));
    }
  }

  return result;
}

/**
 * Serialize a flat Map<key, value> into JSON.
 */
export function serialize(data: Map<string, string>): string {
  const obj: Record<string, string> = {};
  for (const [key, value] of data) {
    obj[key] = value;
  }
  return JSON.stringify(obj, null, 2) + "\n";
}
