import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** POST /org/invitations/:invitationId/revoke — cancel a pending invitation */
export async function POST(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const invitationId = ctx.params.invitationId;

  const result = await sql`
    DELETE FROM invitations
    WHERE id = ${invitationId}
      AND org_id = ${ctx.org.id}
      AND accepted = false
    RETURNING id
  `;

  if (result.length === 0) {
    return new Response("Invitation not found", { status: 404 });
  }

  captureBusinessEvent("invitation_revoked", ctx);

  // Return empty string — hx-swap="outerHTML" removes the row
  return new Response("", { status: 200, headers: { "Content-Type": "text/html" } });
}
