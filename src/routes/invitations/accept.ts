// src/routes/invitations/accept.ts
import type { HandlerFn } from "../../router.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { getSessionToken, validateSession, hashToken } from "../../lib/session.ts";
import { processInvitation } from "../../lib/auth-helpers.ts";

/** GET /invitations/accept?token=X — show invitation info */
export const GET: HandlerFn = async (req, ctx) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return render("pages/invitations-accept.njk", { ctx, error: "missing_token" });
  }

  // Look up invitation by token hash
  const tokenHash = await hashToken(token);
  const [invitation] = await sql`
    SELECT i.id, i.email, i.role, i.expires_at, i.accepted,
           o.name AS org_name,
           u.name AS invited_by_name
    FROM invitations i
    JOIN organizations o ON o.id = i.org_id
    JOIN users u ON u.id = i.invited_by
    WHERE i.token_hash = ${tokenHash}
  `;

  if (!invitation) {
    return render("pages/invitations-accept.njk", { ctx, error: "not_found" });
  }
  if (invitation.accepted) {
    return render("pages/invitations-accept.njk", { ctx, error: "already_accepted" });
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return render("pages/invitations-accept.njk", { ctx, error: "expired" });
  }

  // Check if the visitor is logged in (optional auth — no redirect)
  let loggedInUser: { id: string; email: string; name: string } | null = null;
  const sessionToken = getSessionToken(req);
  if (sessionToken) {
    const session = await validateSession(sessionToken);
    if (session) {
      const [user] = await sql`
        SELECT id, email, name FROM users WHERE id = ${session.userId}
      `;
      if (user) loggedInUser = user;
    }
  }

  const response = render("pages/invitations-accept.njk", {
    ctx,
    token,
    invitation: {
      email: invitation.email,
      role: invitation.role,
      orgName: invitation.org_name,
      invitedByName: invitation.invited_by_name,
    },
    loggedInUser,
    error: "",
  });

  // Prevent invitation token from leaking via Referer header
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};

/** POST /invitations/accept — process invitation for logged-in user */
export const POST: HandlerFn = async (req, ctx) => {
  const form = await req.formData();
  const token = form.get("token") as string || "";

  if (!token) {
    return render("pages/invitations-accept.njk", { ctx, error: "missing_token" });
  }

  // Must be logged in
  const sessionToken = getSessionToken(req);
  if (!sessionToken) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/invitations/accept?token=${encodeURIComponent(token)}` },
    });
  }

  const session = await validateSession(sessionToken);
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/invitations/accept?token=${encodeURIComponent(token)}` },
    });
  }

  const [user] = await sql`
    SELECT id, email, name, email_verified FROM users WHERE id = ${session.userId}
  `;
  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?invite=${encodeURIComponent(token)}` },
    });
  }

  // Require verified email to prevent invitation theft
  if (!user.email_verified) {
    return render("pages/invitations-accept.njk", { ctx, error: "email_not_verified" });
  }

  // Process the invitation
  const orgId = await processInvitation(user.id, user.email, token);
  if (!orgId) {
    return render("pages/invitations-accept.njk", { ctx, error: "invalid_or_expired" });
  }

  // Switch active org to the newly joined one
  await sql`
    UPDATE sessions SET active_org_id = ${orgId} WHERE id = ${session.sessionId}
  `;

  return new Response(null, {
    status: 302,
    headers: { Location: "/dashboard" },
  });
};
