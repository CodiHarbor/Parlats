import type { MiddlewareFn } from "../router.ts";
import { resolveLocale, makeT } from "../lib/i18n.ts";

/**
 * Locale middleware — resolves the user's locale and creates a bound t() function.
 * Must run after auth middleware (needs ctx.user).
 */
export const locale: MiddlewareFn = async (req, ctx, next) => {
  const acceptLang = req.headers.get("Accept-Language");
  ctx.locale = resolveLocale(ctx.user?.locale, acceptLang);
  ctx.t = makeT(ctx.locale);
  return next();
};
