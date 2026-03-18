-- Add per-user opt-out for notification digest emails (GDPR / CAN-SPAM)
ALTER TABLE users ADD COLUMN digest_optout BOOLEAN NOT NULL DEFAULT false;
