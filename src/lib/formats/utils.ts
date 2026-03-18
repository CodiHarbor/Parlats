/**
 * Flatten a nested object into a flat Map with dot-notation keys.
 *   { a: { b: "val" } } → Map { "a.b" => "val" }
 */
export function flattenObject(obj: unknown): Map<string, string> {
  const result = new Map<string, string>();

  function walk(current: unknown, prefix: string): void {
    if (typeof current === "string") {
      result.set(prefix, current);
    } else if (typeof current === "number" || typeof current === "boolean") {
      result.set(prefix, String(current));
    } else if (typeof current === "object" && current !== null && !Array.isArray(current)) {
      for (const [k, v] of Object.entries(current)) {
        walk(v, prefix ? `${prefix}.${k}` : k);
      }
    }
  }

  walk(obj, "");
  return result;
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_NESTING_DEPTH = 20;

/**
 * Unflatten a flat Map with dot-notation keys into a nested object.
 *   Map { "a.b" => "val" } → { a: { b: "val" } }
 */
export function unflattenObject(data: Map<string, string>): Record<string, unknown> {
  const obj: Record<string, unknown> = Object.create(null);

  for (const [key, value] of data) {
    const parts = key.split(".");

    // Skip keys with dangerous property names or excessive depth
    if (parts.length > MAX_NESTING_DEPTH) continue;
    if (parts.some(p => DANGEROUS_KEYS.has(p))) continue;

    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
        current[parts[i]] = Object.create(null);
      }
      current = current[parts[i]] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  return obj;
}
