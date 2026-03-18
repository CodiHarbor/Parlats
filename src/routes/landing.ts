import { render } from "../lib/templates.ts";
import { getSessionToken, validateSession } from "../lib/session.ts";

/** GET / — landing page, with conditional sign-in / dashboard button */
export async function GET(req: Request): Promise<Response> {
  let isSignedIn = false;

  if (process.env.NODE_ENV !== "production") {
    // Dev mode: dev user is always "logged in"
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

  return render("pages/landing.njk", {
    year: new Date().getFullYear(),
    requestPath: "/",
    isSignedIn,
  });
}
