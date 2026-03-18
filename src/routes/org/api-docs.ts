import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";

/** GET /org/api-docs — API documentation page */
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  return render("pages/org/api-docs.njk", { ctx, activePage: "api-keys" });
}
