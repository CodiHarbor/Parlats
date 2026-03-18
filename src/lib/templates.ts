import nunjucks from "nunjucks";
import path from "path";
import { highlightTokens } from "./interpolation/parse.ts";
import { isStripeEnabled } from "./stripe.ts";
import { timeago } from "./timeago.ts";

const templatesDir = path.join(import.meta.dir, "../templates");
const appUrl = (process.env.APP_URL || "http://localhost:3100").replace(/\/+$/, "");

// Read version from package.json
const pkg = await Bun.file(path.join(import.meta.dir, "../../package.json")).json();
const appVersion = pkg.version as string;

const env = nunjucks.configure(templatesDir, {
  autoescape: true,
  noCache: process.env.NODE_ENV !== "production",
});

// Globals available in all templates (including emails rendered via nunjucks.render)
env.addGlobal("appUrl", appUrl);
env.addGlobal("appVersion", appVersion);

// Custom filters
env.addFilter("date", (val: string | Date, locale?: string) => {
  const d = val instanceof Date ? val : new Date(val);
  const loc = (typeof locale === "string" && locale) ? locale : "en-US";
  return d.toLocaleDateString(loc, { year: "numeric", month: "short", day: "numeric" });
});

env.addFilter("timeago", (val: string | Date, locale?: string) => {
  return timeago(val, typeof locale === "string" ? locale : "en");
});

env.addFilter("highlight_tokens", (val: string, format: string) => {
  return new nunjucks.runtime.SafeString(highlightTokens(val || "", format || "auto"));
});

/** Render a template to an HTML Response */
export function render(
  template: string,
  data: Record<string, unknown> = {},
  status = 200,
): Response {
  // Auto-inject t() and locale from ctx if present
  const ctx = data.ctx as any;
  if (ctx?.t && !data.t) data.t = ctx.t;
  if (ctx?.locale && !data.locale) data.locale = ctx.locale;
  // Provide a no-op t() fallback for safety
  if (!data.t) data.t = (key: string) => key;
  if (!data.locale) data.locale = "en";

  // Inject CSRF token for forms
  if (ctx?.csrfToken && !data.csrfToken) data.csrfToken = ctx.csrfToken;
  // Inject nonce for CSP
  if (ctx?.nonce && !data.nonce) data.nonce = ctx.nonce;
  if (!data.appUrl) data.appUrl = appUrl;

  // Flag degraded subscriptions so the billing banner shows
  // Only flag truly degraded states (had a subscription but it went bad),
  // not brand-new orgs that never subscribed
  if (ctx?.org && isStripeEnabled()) {
    const status = ctx.org.subscriptionStatus ?? "none";
    data.subscriptionDegraded = ["past_due", "unpaid", "incomplete_expired"].includes(status);
  }

  const html = env.render(template, data);
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Render a template string (for partials/fragments) to an HTML Response */
export function renderString(
  source: string,
  data: Record<string, unknown> = {},
  status = 200,
): Response {
  const ctx = data.ctx as any;
  if (ctx?.t && !data.t) data.t = ctx.t;
  if (ctx?.locale && !data.locale) data.locale = ctx.locale;
  if (!data.t) data.t = (key: string) => key;
  if (!data.locale) data.locale = "en";
  if (!data.appUrl) data.appUrl = appUrl;

  const html = env.renderString(source, data);
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export { env as nunjucks };
