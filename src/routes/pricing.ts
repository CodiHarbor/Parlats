import { render } from "../lib/templates.ts";
import { getSessionToken, validateSession } from "../lib/session.ts";
import type { RequestContext } from "../types/index.ts";

export async function GET(req: Request, ctx: RequestContext): Promise<Response> {
  let isSignedIn = false;

  if (process.env.NODE_ENV !== "production") {
    isSignedIn = true;
  } else {
    const token = getSessionToken(req);
    if (token) {
      const session = await validateSession(token);
      if (session) {
        isSignedIn = true;
      }
    }
  }

  return render("pages/pricing.njk", { ctx, user: ctx.user ?? null, isSignedIn });
}
