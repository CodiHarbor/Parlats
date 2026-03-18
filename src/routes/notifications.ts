import type { AuthenticatedContext } from "../types/index.ts";
import { render } from "../lib/templates.ts";
import { getUnreadCount, getNotifications } from "../lib/notifications.ts";

/** GET /notifications — full notifications page */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = 30;
  const offset = (page - 1) * limit;

  const notifications = await getNotifications(ctx.org.id, ctx.user.id, {
    type,
    limit: limit + 1,
    offset,
  });

  const hasMore = notifications.length > limit;
  const items = hasMore ? notifications.slice(0, limit) : notifications;
  const unreadCount = await getUnreadCount(ctx.org.id, ctx.user.id);

  return render("pages/notifications.njk", {
    notifications: items,
    unreadCount,
    currentType: type || "all",
    page,
    hasMore,
    ctx,
    activePage: "notifications",
  });
}
