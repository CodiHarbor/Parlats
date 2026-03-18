import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { getUnreadCount } from "../../lib/notifications.ts";

export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const count = await getUnreadCount(ctx.org.id, ctx.user.id);
  return render("partials/notification-badge.njk", { count, ctx });
}
