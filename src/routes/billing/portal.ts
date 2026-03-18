import type { AuthenticatedContext } from "../../types.ts";
import { getStripe, isStripeEnabled } from "../../lib/stripe.ts";
import { sql } from "../../db/client.ts";

export async function POST(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  if (!isStripeEnabled()) {
    return new Response("Billing not available", { status: 404 });
  }

  const appUrl = Bun.env.APP_URL ?? `http://localhost:${Bun.env.PORT ?? 3100}`;

  const [org] = await sql`
    SELECT stripe_customer_id FROM organizations WHERE id = ${ctx.org.id}
  `;

  if (!org?.stripe_customer_id) {
    return Response.redirect(`${appUrl}/billing`, 303);
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${appUrl}/billing`,
  });

  return Response.redirect(session.url, 303);
}
