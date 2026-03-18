import { render } from "../lib/templates.ts";

/** GET /privacy — Privacy Policy */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const page = url.pathname === "/terms" ? "pages/terms.njk" : "pages/privacy.njk";
  const pageTitle =
    url.pathname === "/terms"
      ? "Terms of Service — Parlats"
      : "Privacy Policy — Parlats";

  return render(page, { pageTitle, requestPath: url.pathname });
}
