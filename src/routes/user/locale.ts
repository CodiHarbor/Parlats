import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { SUPPORTED_LOCALES } from "../../lib/i18n.ts";

/** POST /user/locale — update user's preferred locale */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const formData = await req.formData();
  const newLocale = formData.get("locale") as string;

  if (!newLocale || !SUPPORTED_LOCALES.includes(newLocale)) {
    return new Response("Invalid locale", { status: 400 });
  }

  await sql`UPDATE users SET locale = ${newLocale} WHERE id = ${ctx.user.id}`;

  // Redirect back to referrer (validated same-origin) or home
  const referer = req.headers.get("Referer");
  const requestUrl = new URL(req.url);
  let redirectTo = requestUrl.origin + "/";
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.origin === requestUrl.origin) {
        redirectTo = refererUrl.href;
      }
    } catch {
      // Invalid URL — fall back to home
    }
  }
  return Response.redirect(redirectTo, 303);
}
