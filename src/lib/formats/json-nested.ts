import { flattenObject, unflattenObject } from "./utils.ts";

/**
 * Parse nested JSON into a flat Map<key, value>.
 * Nested objects are flattened with dot-notation.
 */
export function parse(content: string): Map<string, string> {
  return flattenObject(JSON.parse(content));
}

/**
 * Serialize a flat Map<key, value> into nested JSON.
 * Dot-notation keys are reconstructed into nested objects.
 */
export function serialize(data: Map<string, string>): string {
  return JSON.stringify(unflattenObject(data), null, 2) + "\n";
}
