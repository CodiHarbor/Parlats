import { getStripe, isStripeEnabled } from "./stripe.ts";
import { sql } from "../db/client.ts";

const ONE_HOUR_MS = 60 * 60 * 1000;

export function shouldReconcile(lastReconciledAt: Date | null): boolean {
  if (!lastReconciledAt) return true;
  return Date.now() - lastReconciledAt.getTime() > ONE_HOUR_MS;
}

/**
 * Check Stripe for the current subscription status and sync to local DB.
 * Called from the subscription middleware on authenticated requests.
 * Throttled to once per hour per org via last_reconciled_at.
 */
export async function reconcileSubscription(orgId: string): Promise<void> {
  if (!isStripeEnabled()) return;

  const [sub] = await sql`
    SELECT stripe_subscription_id, last_reconciled_at
    FROM subscriptions
    WHERE org_id = ${orgId}
  `;

  if (!sub?.stripe_subscription_id) return;
  if (!shouldReconcile(sub.last_reconciled_at)) return;

  try {
    const stripeSub = await getStripe().subscriptions.retrieve(sub.stripe_subscription_id);
    const item = stripeSub.items.data[0];
    const periodStart = item ? new Date(item.current_period_start * 1000).toISOString() : null;
    const periodEnd = item ? new Date(item.current_period_end * 1000).toISOString() : null;
    const cancelAt = stripeSub.cancel_at ? new Date(stripeSub.cancel_at * 1000).toISOString() : null;

    await sql`
      UPDATE subscriptions SET
        status = ${stripeSub.status},
        current_period_start = COALESCE(${periodStart}, current_period_start),
        current_period_end = COALESCE(${periodEnd}, current_period_end),
        cancel_at = ${cancelAt},
        last_reconciled_at = now(),
        updated_at = now()
      WHERE org_id = ${orgId}
    `;

    await sql`
      UPDATE organizations SET subscription_status = ${stripeSub.status}
      WHERE id = ${orgId}
    `;
  } catch (err) {
    console.error(`[Reconcile] Failed for org ${orgId}:`, err);
    // Don't throw — reconciliation failure shouldn't break the request
  }
}
