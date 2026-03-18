-- Stripe subscription billing for Parlats Cloud
-- Adds subscription tracking to organizations and a dedicated subscriptions table.

-- Cached subscription status on organizations for fast middleware checks.
-- Source of truth is the subscriptions table (synced from Stripe via webhooks).
ALTER TABLE organizations
  ADD COLUMN stripe_customer_id TEXT,
  ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'none';

-- Full subscription details, one per org.
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_price_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_org_id ON subscriptions(org_id);
CREATE INDEX idx_subscriptions_stripe_sub_id ON subscriptions(stripe_subscription_id);
