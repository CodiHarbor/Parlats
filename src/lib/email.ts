// src/lib/email.ts
import { Resend } from "resend";

export interface SendEmailOpts {
  to: string;
  subject: string;
  html: string;
}

const RESEND_API_KEY = Bun.env.RESEND_API_KEY;
const FROM_ADDRESS = Bun.env.EMAIL_FROM ?? "Parlats <noreply@parlats.com>";

let resend: Resend | null = null;
if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
}

/**
 * Send an email via Resend. Falls back to console logging in dev
 * when RESEND_API_KEY is not set.
 */
export async function sendEmail(opts: SendEmailOpts): Promise<void> {
  if (!resend) {
    console.log(`[MOCK EMAIL] To: ${opts.to}`);
    console.log(`[MOCK EMAIL] Subject: ${opts.subject}`);
    console.log(`[MOCK EMAIL] Body length: ${opts.html.length} chars`);
    return;
  }

  await resend.emails.send({
    from: FROM_ADDRESS,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
