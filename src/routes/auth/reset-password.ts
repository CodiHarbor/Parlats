import type { HandlerFn } from "../../router.ts";
import { render } from "../../lib/templates.ts";
import { validateResetToken, resetPassword } from "../../lib/password-reset.ts";

/** GET /auth/reset-password?token=X — show new password form */
export const GET: HandlerFn = async (req, ctx) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return render("pages/reset-password.njk", { ctx, error: "missing_token" });
  }

  const userId = await validateResetToken(token);
  if (!userId) {
    return render("pages/reset-password.njk", { ctx, error: "invalid_token" });
  }

  return render("pages/reset-password.njk", { ctx, token });
};

/** POST /auth/reset-password — update password */
export const POST: HandlerFn = async (req, ctx) => {
  const form = await req.formData();
  const token = form.get("token") as string || "";
  const password = form.get("password") as string || "";
  const confirm = form.get("password_confirm") as string || "";

  if (!token) {
    return render("pages/reset-password.njk", { ctx, error: "missing_token" });
  }
  if (password.length < 8) {
    return render("pages/reset-password.njk", { ctx, token, error: "password_too_short" });
  }
  if (password !== confirm) {
    return render("pages/reset-password.njk", { ctx, token, error: "password_mismatch" });
  }

  const success = await resetPassword(token, password);
  if (!success) {
    return render("pages/reset-password.njk", { ctx, error: "invalid_token" });
  }

  return new Response(null, {
    status: 302,
    headers: { Location: "/login?error=password_reset_success" },
  });
};
