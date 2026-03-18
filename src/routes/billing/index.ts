import type { AuthenticatedContext } from "../../types.ts";
import { render } from "../../lib/templates.ts";
import { isStripeEnabled } from "../../lib/stripe.ts";
import { sql } from "../../db/client.ts";

export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  if (!isStripeEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const [subscription] = await sql`
    SELECT stripe_subscription_id, status, current_period_start, current_period_end, cancel_at
    FROM subscriptions
    WHERE org_id = ${ctx.org.id}
  `;

  const url = new URL(req.url);
  const error = url.searchParams.get("error");

  return render("pages/billing.njk", {
    ctx,
    subscription: subscription ?? null,
    activePage: "billing",
    verifyEmailRequired: error === "verify_email",
  });
}
