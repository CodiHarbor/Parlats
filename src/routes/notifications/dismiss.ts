import type { AuthenticatedContext } from "../../types/index.ts";
import { dismissNotification } from "../../lib/notifications.ts";

export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  await dismissNotification(ctx.org.id, ctx.user.id, ctx.params.id);
  if (req.headers.get("HX-Request")) {
    return new Response("", { status: 200 });
  }
  return Response.redirect("/notifications", 303);
}
