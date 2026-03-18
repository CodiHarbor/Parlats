import type { AuthenticatedContext } from "../../types.ts";
import { getStripe, getPriceId, isStripeEnabled } from "../../lib/stripe.ts";
import { sql } from "../../db/client.ts";

export async function POST(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  if (!isStripeEnabled()) {
    return new Response("Billing not available", { status: 404 });
  }

  // Require email verification before allowing subscription
  if (!ctx.user.emailVerified) {
    return Response.redirect("/billing?error=verify_email", 303);
  }

  const appUrl = Bun.env.APP_URL ?? `http://localhost:${Bun.env.PORT ?? 3100}`;

  // Reuse existing Stripe customer if org already has one (e.g. re-subscribing after cancellation)
  const [org] = await sql`
    SELECT stripe_customer_id FROM organizations WHERE id = ${ctx.org.id}
  `;

  const sessionParams: Record<string, unknown> = {
    mode: "subscription",
    line_items: [{ price: getPriceId(), quantity: 1 }],
    metadata: { org_id: ctx.org.id },
    success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/pricing`,
  };

  if (org?.stripe_customer_id) {
    sessionParams.customer = org.stripe_customer_id;
  } else {
    sessionParams.customer_email = ctx.user.email;
  }

  const session = await getStripe().checkout.sessions.create(sessionParams as any);

  return Response.redirect(session.url!, 303);
}
