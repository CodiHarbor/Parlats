import Stripe from "stripe";

const STRIPE_SECRET_KEY = Bun.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = Bun.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = Bun.env.STRIPE_PRICE_ID;

let stripe: Stripe | null = null;

if (STRIPE_SECRET_KEY) {
  stripe = new Stripe(STRIPE_SECRET_KEY);
}

export function isStripeEnabled(): boolean {
  return stripe !== null;
}

export function getStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }
  return stripe;
}

export function getWebhookSecret(): string {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }
  return STRIPE_WEBHOOK_SECRET;
}

export function getPriceId(): string {
  if (!STRIPE_PRICE_ID) {
    throw new Error("STRIPE_PRICE_ID is not configured.");
  }
  return STRIPE_PRICE_ID;
}
