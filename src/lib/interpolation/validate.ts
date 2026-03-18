import { extractTokens } from "./parse.ts";

export interface ValidationWarning {
  type: "missing_token" | "extra_token";
  token: string;
}

/** Compare source and translation tokens, return soft warnings */
export function validateTranslation(
  sourceValue: string,
  translationValue: string,
  format: string,
): ValidationWarning[] {
  if (!sourceValue || !translationValue) return [];

  const sourceTokens = extractTokens(sourceValue, format);
  const translationTokens = extractTokens(translationValue, format);

  const warnings: ValidationWarning[] = [];

  // Check for missing tokens (in source but not in translation)
  const translationSet = new Set(translationTokens);
  for (const token of sourceTokens) {
    if (!translationSet.has(token)) {
      warnings.push({ type: "missing_token", token });
    }
  }

  // Check for extra tokens (in translation but not in source)
  const sourceSet = new Set(sourceTokens);
  for (const token of translationTokens) {
    if (!sourceSet.has(token)) {
      warnings.push({ type: "extra_token", token });
    }
  }

  return warnings;
}
