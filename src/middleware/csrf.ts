import type { MiddlewareFn } from "../router.ts";

const CSRF_COOKIE = "parlats_csrf";
const CSRF_HEADER = "x-csrf-token";
const CSRF_FORM_FIELD = "_csrf";

export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function validateCsrfToken(expected: string, actual: string): boolean {
  if (!expected || !actual) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(expected);
  const b = encoder.encode(actual);
  if (a.byteLength !== b.byteLength) {
    // Pad shorter to match longer, then compare — avoids leaking length via timing
    const maxLen = Math.max(a.byteLength, b.byteLength);
    const padA = new Uint8Array(maxLen);
    const padB = new Uint8Array(maxLen);
    padA.set(a);
    padB.set(b);
    let mismatch = 1; // force fail for different lengths
    for (let i = 0; i < maxLen; i++) {
      mismatch |= padA[i] ^ padB[i];
    }
    return false; // different lengths always fail, but we did constant-time work
  }
  let mismatch = 0;
  for (let i = 0; i < a.byteLength; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

const isSecure = process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production";

export const csrf: MiddlewareFn = async (req, ctx, next) => {
  const cookieToken = getCsrfCookie(req);
  const token = cookieToken || generateCsrfToken();
  (ctx as any).csrfToken = token;

  const method = req.method.toUpperCase();
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    let submittedToken = req.headers.get(CSRF_HEADER);
    if (!submittedToken) {
      // Only try formData for form submissions — skip for JSON/other content types
      const contentType = req.headers.get("Content-Type") || "";
      if (contentType.includes("form")) {
        try {
          const cloned = req.clone();
          const formData = await cloned.formData();
          submittedToken = formData.get(CSRF_FORM_FIELD) as string | null;
        } catch {
          // Not a valid form submission
        }
      }
    }
    if (!cookieToken || !validateCsrfToken(cookieToken, submittedToken || "")) {
      return new Response("CSRF token validation failed", { status: 403 });
    }
  }

  const response = await next();

  if (!cookieToken) {
    const headers = new Headers(response.headers);
    const secure = isSecure ? "; Secure" : "";
    headers.append(
      "Set-Cookie",
      `${CSRF_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/${secure}`,
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return response;
};

function getCsrfCookie(req: Request): string | null {
  const cookieHeader = req.headers.get("Cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE) return rest.join("=");
  }
  return null;
}
