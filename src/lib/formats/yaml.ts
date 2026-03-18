import yaml from "js-yaml";
import { flattenObject, unflattenObject } from "./utils.ts";

/**
 * Parse YAML into flat Map<key, value>.
 * Nested structures are flattened with dot notation (same as JSON nested).
 */
export function parse(content: string): Map<string, string> {
  return flattenObject(yaml.load(content));
}

/**
 * Serialize flat Map<key, value> into nested YAML.
 */
export function serialize(data: Map<string, string>): string {
  return yaml.dump(unflattenObject(data), { lineWidth: -1, quotingType: '"', forceQuotes: false });
}
