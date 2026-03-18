import type { RequestContext } from "../types/index.ts";
import { isStripeEnabled } from "../lib/stripe.ts";
import { reconcileSubscription } from "../lib/reconcile-subscription.ts";

type NextFn = () => Promise<Response>;

export async function subscriptionGuard(
  req: Request,
  ctx: RequestContext,
  next: NextFn,
): Promise<Response> {
  // Self-hosted mode — skip all billing checks
  if (!isStripeEnabled()) {
    return next();
  }

  const org = ctx.org;
  if (!org) {
    return next();
  }

  // Fire-and-forget reconciliation (don't block the request)
  reconcileSubscription(org.id).catch(() => {});

  const status = org.subscriptionStatus ?? "none";
  const url = new URL(req.url);
  const path = url.pathname;

  // Billing routes are always allowed (so users can fix their subscription)
  if (path.startsWith("/billing") || path === "/pricing") {
    return next();
  }

  // Active subscription — full access
  if (status === "active") {
    return next();
  }

  // Not active — enforce restrictions
  const isApiRoute = path.startsWith("/api/");

  // API routes: deny entirely (401)
  if (isApiRoute) {
    return Response.json(
      { error: "Subscription required. Visit /billing to subscribe." },
      { status: 401 },
    );
  }

  // Web routes: allow GET (read-only), block writes
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return next();
  }

  // Block write operations with 403
  return new Response("Subscription required. Please update your billing to continue.", {
    status: 403,
    headers: { "Content-Type": "text/html" },
  });
}
