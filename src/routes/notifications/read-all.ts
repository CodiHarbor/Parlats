import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { getUnreadCount, markAllAsRead } from "../../lib/notifications.ts";

export async function POST(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  await markAllAsRead(ctx.org.id, ctx.user.id);
  const count = await getUnreadCount(ctx.org.id, ctx.user.id);
  return render("partials/notification-badge.njk", { count, ctx });
}
