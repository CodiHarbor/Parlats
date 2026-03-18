import type { HandlerFn } from "../../router.ts";
import { render } from "../../lib/templates.ts";
import { sendPasswordResetEmail } from "../../lib/password-reset.ts";

/** GET /auth/forgot-password — show reset request form */
export const GET: HandlerFn = async (_req, ctx) => {
  return render("pages/forgot-password.njk", { ctx });
};

/** POST /auth/forgot-password — send reset email */
export const POST: HandlerFn = async (req, ctx) => {
  const form = await req.formData();
  const email = (form.get("email") as string || "").trim().toLowerCase();

  if (email && email.includes("@")) {
    await sendPasswordResetEmail(email);
  }

  // Always show success (no email enumeration)
  return render("pages/forgot-password.njk", { ctx, sent: true });
};
