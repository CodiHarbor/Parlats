export type SegmentType = "text" | "variable" | "tag_open" | "tag_close" | "nesting";

export interface Segment {
  type: SegmentType;
  value: string;
}

// Patterns for different interpolation formats
const I18NEXT_PATTERNS = [
  { type: "variable" as const, regex: /\{\{[^}]+\}\}/g },
  { type: "nesting" as const, regex: /\$t\([^)]+\)/g },
  { type: "tag_open" as const, regex: /<(\w+)>/g },
  { type: "tag_close" as const, regex: /<\/(\w+)>/g },
];

const ICU_PATTERNS = [
  { type: "variable" as const, regex: /\{[^},]+(?:,\s*(?:plural|select|selectordinal)[^}]*(?:\{[^}]*\}[^}]*)*)\}/g },
  { type: "variable" as const, regex: /\{[^}]+\}/g },
  { type: "tag_open" as const, regex: /<(\w+)>/g },
  { type: "tag_close" as const, regex: /<\/(\w+)>/g },
];

/** Parse a translation value into highlighted segments */
export function parseTokens(value: string, format: string): Segment[] {
  if (!value) return [];

  const patterns = format === "icu" ? ICU_PATTERNS : I18NEXT_PATTERNS;

  // Find all token positions
  const tokens: { start: number; end: number; type: SegmentType; value: string }[] = [];

  for (const { type, regex } of patterns) {
    const re = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = re.exec(value)) !== null) {
      // Skip if this range overlaps with an existing token
      const overlaps = tokens.some(
        t => match!.index < t.end && match!.index + match![0].length > t.start
      );
      if (!overlaps) {
        tokens.push({
          start: match.index,
          end: match.index + match[0].length,
          type,
          value: match[0],
        });
      }
    }
  }

  // Sort by position
  tokens.sort((a, b) => a.start - b.start);

  // Build segments with text between tokens
  const segments: Segment[] = [];
  let cursor = 0;

  for (const token of tokens) {
    if (token.start > cursor) {
      segments.push({ type: "text", value: value.slice(cursor, token.start) });
    }
    segments.push({ type: token.type, value: token.value });
    cursor = token.end;
  }

  if (cursor < value.length) {
    segments.push({ type: "text", value: value.slice(cursor) });
  }

  return segments;
}

/** Extract just the token values (non-text segments) for comparison */
export function extractTokens(value: string, format: string): string[] {
  return parseTokens(value, format)
    .filter(s => s.type !== "text")
    .map(s => s.value);
}

/** Render segments as highlighted HTML (for display in editor cells) */
export function highlightTokens(value: string, format: string): string {
  if (!value) return "";
  if (format === "auto") format = "i18next"; // default to i18next for display

  const segments = parseTokens(value, format);

  // If no tokens found, return escaped text
  if (segments.length === 1 && segments[0].type === "text") {
    return escapeHtml(value);
  }

  return segments.map(seg => {
    const escaped = escapeHtml(seg.value);
    if (seg.type === "text") return escaped;
    return `<span class="inline-block px-1 py-0.5 bg-primary/10 text-primary rounded text-xs font-mono">${escaped}</span>`;
  }).join("");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
