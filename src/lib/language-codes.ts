/**
 * Map common language display names to ISO 639-1 codes.
 * Used during bulk import when XLSX/CSV headers use full names instead of codes.
 */
const NAME_TO_CODE: Record<string, string> = {
  // English variants
  "english": "en",
  "english (us)": "en-US",
  "english (uk)": "en-GB",
  "english (au)": "en-AU",
  "english (ca)": "en-CA",
  // European
  "french": "fr",
  "french (fr)": "fr-FR",
  "french (ca)": "fr-CA",
  "german": "de",
  "german (de)": "de-DE",
  "german (at)": "de-AT",
  "german (ch)": "de-CH",
  "spanish": "es",
  "spanish (es)": "es-ES",
  "spanish (mx)": "es-MX",
  "spanish (latam)": "es-419",
  "italian": "it",
  "italian (it)": "it-IT",
  "portuguese": "pt",
  "portuguese (br)": "pt-BR",
  "portuguese (pt)": "pt-PT",
  "dutch": "nl",
  "dutch (nl)": "nl-NL",
  "polish": "pl",
  "polish (pl)": "pl-PL",
  "russian": "ru",
  "russian (ru)": "ru-RU",
  "ukrainian": "uk",
  "czech": "cs",
  "slovak": "sk",
  "hungarian": "hu",
  "romanian": "ro",
  "bulgarian": "bg",
  "croatian": "hr",
  "serbian": "sr",
  "slovenian": "sl",
  "greek": "el",
  "turkish": "tr",
  "finnish": "fi",
  "swedish": "sv",
  "norwegian": "no",
  "norwegian (bokmål)": "nb",
  "norwegian (nynorsk)": "nn",
  "danish": "da",
  "icelandic": "is",
  // Asian
  "japanese": "ja",
  "japanese (jp)": "ja-JP",
  "korean": "ko",
  "korean (kr)": "ko-KR",
  "chinese": "zh",
  "chinese (simplified)": "zh-CN",
  "chinese (traditional)": "zh-TW",
  "chinese (cn)": "zh-CN",
  "chinese (tw)": "zh-TW",
  "chinese (hk)": "zh-HK",
  "thai": "th",
  "vietnamese": "vi",
  "indonesian": "id",
  "malay": "ms",
  "hindi": "hi",
  "bengali": "bn",
  "tamil": "ta",
  "telugu": "te",
  "marathi": "mr",
  "gujarati": "gu",
  "kannada": "kn",
  "malayalam": "ml",
  "punjabi": "pa",
  "urdu": "ur",
  // Middle Eastern
  "arabic": "ar",
  "hebrew": "he",
  "persian": "fa",
  "farsi": "fa",
  // African
  "swahili": "sw",
  "afrikaans": "af",
  // Other
  "catalan": "ca",
  "basque": "eu",
  "galician": "gl",
  "welsh": "cy",
  "irish": "ga",
  "estonian": "et",
  "latvian": "lv",
  "lithuanian": "lt",
  "filipino": "fil",
  "tagalog": "tl",
};

/**
 * Normalize a language header to a short code.
 * If already a valid short code (e.g. "en", "fr-CA"), returns as-is.
 * If a display name (e.g. "English (US)"), maps to the code.
 * Falls back to lowercased input truncated to 10 chars.
 */
export function normalizeLanguageCode(header: string): string {
  const trimmed = header.trim();

  // Already looks like a code (2-3 chars, or xx-XX pattern)
  if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(trimmed)) return trimmed;
  if (/^[a-z]{2,3}-[A-Z]{2,4}$/.test(trimmed)) return trimmed;

  // Try lookup
  const code = NAME_TO_CODE[trimmed.toLowerCase()];
  if (code) return code;

  // Last resort: return as-is if short enough, otherwise truncate
  return trimmed.length <= 10 ? trimmed : trimmed.substring(0, 10);
}
