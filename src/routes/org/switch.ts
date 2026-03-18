import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";

/** POST /org/switch/:id — switch the user's active organization */
export async function POST(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const targetOrgId = ctx.params.id;

  // Verify user is a member of the target org
  const [membership] = await sql`
    SELECT org_id FROM org_members
    WHERE user_id = ${ctx.user.id} AND org_id = ${targetOrgId}
  `;

  if (!membership) {
    return new Response("Forbidden", { status: 403 });
  }

  // Update the session's active org
  // Note: In dev mode, _session is not set by the auth middleware (it uses a hardcoded user).
  // The org-context middleware also hardcodes DEV_ORG in dev mode, so switching has no visible
  // effect during development. This is expected — test org switching in production mode or E2E tests.
  const session = (ctx as any)._session;
  if (session?.sessionId) {
    await sql`
      UPDATE sessions SET active_org_id = ${targetOrgId} WHERE id = ${session.sessionId}
    `;
  }

  return new Response(null, {
    status: 303,
    headers: { Location: "/dashboard" },
  });
}
