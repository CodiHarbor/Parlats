import type { RequestContext } from "../../types.ts";
import { getStripe, getWebhookSecret, isStripeEnabled } from "../../lib/stripe.ts";
import { sql } from "../../db/client.ts";
import type Stripe from "stripe";

export async function POST(req: Request, _ctx: RequestContext): Promise<Response> {
  if (!isStripeEnabled()) {
    return new Response("Stripe not configured", { status: 400 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(body, sig, getWebhookSecret());
  } catch (err) {
    console.error("[Stripe Webhook] Signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    console.error("[Stripe Webhook] Error handling event:", err);
    return new Response("Webhook handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    default:
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const orgId = session.metadata?.org_id;
  if (!orgId) {
    console.error("[Stripe Webhook] checkout.session.completed missing org_id in metadata");
    return;
  }

  const subscriptionId = session.subscription as string | null;
  const customerId = session.customer as string | null;
  if (!subscriptionId || !customerId) {
    console.error("[Stripe Webhook] checkout.session.completed missing subscription or customer");
    return;
  }
  console.log(`[Stripe Webhook] Processing checkout.session.completed for org ${orgId}`);

  // Fetch full subscription details from Stripe
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);

  // Update org with Stripe customer ID and active status
  await sql`
    UPDATE organizations
    SET stripe_customer_id = ${customerId},
        subscription_status = 'active'
    WHERE id = ${orgId}
  `;

  // In Stripe SDK v20+, period fields live on subscription items, not the subscription itself
  const item = subscription.items.data[0];
  const periodStart = item ? new Date(item.current_period_start * 1000).toISOString() : new Date().toISOString();
  const periodEnd = item ? new Date(item.current_period_end * 1000).toISOString() : new Date().toISOString();
  const cancelAt = subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null;

  // Upsert subscription record (idempotent — handles duplicate webhooks)
  await sql`
    INSERT INTO subscriptions (org_id, stripe_subscription_id, stripe_price_id, status,
      current_period_start, current_period_end, cancel_at)
    VALUES (
      ${orgId},
      ${subscriptionId},
      ${item?.price.id ?? ""},
      ${subscription.status},
      ${periodStart},
      ${periodEnd},
      ${cancelAt}
    )
    ON CONFLICT (org_id) DO UPDATE SET
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      stripe_price_id = EXCLUDED.stripe_price_id,
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at = EXCLUDED.cancel_at,
      updated_at = now()
  `;
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) return;

  await sql`
    UPDATE subscriptions SET status = 'active', updated_at = now()
    WHERE stripe_subscription_id = ${subscriptionId}
  `;
  await sql`
    UPDATE organizations SET subscription_status = 'active'
    WHERE id = (SELECT org_id FROM subscriptions WHERE stripe_subscription_id = ${subscriptionId})
  `;
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoice.subscription as string;
  if (!subscriptionId) return;

  await sql`
    UPDATE subscriptions SET status = 'past_due', updated_at = now()
    WHERE stripe_subscription_id = ${subscriptionId}
  `;
  await sql`
    UPDATE organizations SET subscription_status = 'past_due'
    WHERE id = (SELECT org_id FROM subscriptions WHERE stripe_subscription_id = ${subscriptionId})
  `;
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const item = subscription.items.data[0];
  const periodStart = item ? new Date(item.current_period_start * 1000).toISOString() : null;
  const periodEnd = item ? new Date(item.current_period_end * 1000).toISOString() : null;
  const cancelAt = subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null;

  await sql`
    UPDATE subscriptions SET
      status = ${subscription.status},
      current_period_start = COALESCE(${periodStart}, current_period_start),
      current_period_end = COALESCE(${periodEnd}, current_period_end),
      cancel_at = ${cancelAt},
      updated_at = now()
    WHERE stripe_subscription_id = ${subscription.id}
  `;
  await sql`
    UPDATE organizations SET subscription_status = ${subscription.status}
    WHERE id = (SELECT org_id FROM subscriptions WHERE stripe_subscription_id = ${subscription.id})
  `;
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  await sql`
    UPDATE subscriptions SET status = 'canceled', updated_at = now()
    WHERE stripe_subscription_id = ${subscription.id}
  `;
  await sql`
    UPDATE organizations SET subscription_status = 'canceled'
    WHERE id = (SELECT org_id FROM subscriptions WHERE stripe_subscription_id = ${subscription.id})
  `;
}
