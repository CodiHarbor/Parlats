/** Security headers applied to every response */

const isProduction = process.env.NODE_ENV === "production";

/** Generate a cryptographically random CSP nonce (base64, 16 bytes). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function buildSecurityHeaders(nonce?: string): [string, string][] {
  const scriptSrc = nonce
    ? `'self' 'nonce-${nonce}'`
    : "'self' 'unsafe-inline'";

  // script-src-attr allows inline event handlers (onclick, etc.)
  // while script-src with nonce still blocks injected <script> tags
  const scriptSrcAttr = nonce ? " script-src-attr 'unsafe-inline';" : "";

  return [
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["X-XSS-Protection", "0"],
    [
      "Content-Security-Policy",
      `default-src 'self'; script-src ${scriptSrc};${scriptSrcAttr} style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com`,
    ],
    ...(isProduction ? [["Strict-Transport-Security", "max-age=63072000; includeSubDomains"] as [string, string]] : []),
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"],
  ];
}

/**
 * Wrap a Response with security headers.
 * Pass a nonce to use nonce-based CSP instead of unsafe-inline.
 */
export function addSecurityHeaders(response: Response, nonce?: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of buildSecurityHeaders(nonce)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
