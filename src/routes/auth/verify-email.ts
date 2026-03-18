import type { HandlerFn } from "../../router.ts";
import { render } from "../../lib/templates.ts";
import { verifyEmailToken } from "../../lib/email-verification.ts";

/** GET /auth/verify-email?token=X or ?sent=1 */
export const GET: HandlerFn = async (req, ctx) => {
  const url = new URL(req.url);

  // Just sent — show "check your email" message
  if (url.searchParams.get("sent") === "1") {
    return render("pages/verify-email.njk", { ctx, status: "sent" });
  }

  const token = url.searchParams.get("token") || "";
  if (!token) {
    return render("pages/verify-email.njk", { ctx, status: "missing_token" });
  }

  const userId = await verifyEmailToken(token);
  if (!userId) {
    return render("pages/verify-email.njk", { ctx, status: "invalid" });
  }

  return render("pages/verify-email.njk", { ctx, status: "verified" });
};
