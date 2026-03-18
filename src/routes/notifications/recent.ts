import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { getUnreadCount, getNotifications } from "../../lib/notifications.ts";

export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const notifications = await getNotifications(ctx.org.id, ctx.user.id, { limit: 10, offset: 0 });
  const count = await getUnreadCount(ctx.org.id, ctx.user.id);
  return render("partials/notification-dropdown.njk", { notifications, count, ctx });
}
