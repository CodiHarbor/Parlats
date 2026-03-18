const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate a string is a well-formed UUID */
export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Validate an import token is a safe UUID (prevents path traversal) */
export function isValidImportToken(token: string): boolean {
  return UUID_RE.test(token);
}

/** Sanitize a filename for use in Content-Disposition headers */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}
