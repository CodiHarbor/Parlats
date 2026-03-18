import type { AuthenticatedContext } from "../../types.ts";
import { render } from "../../lib/templates.ts";

// Webhook handles actual subscription activation — this is just a confirmation page.
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  return render("pages/billing-success.njk", { ctx });
}
