import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { z } from "zod/v4";
import { getNotificationConfig } from "../../lib/notifications.ts";

const VALID_COOLDOWNS = [12, 24, 48, 168] as const;

const NotificationConfigSchema = z.object({
  untranslated_threshold: z.coerce.number().int().min(1).max(10000),
  email_cooldown_hours: z.coerce.number().int().refine((v) => (VALID_COOLDOWNS as readonly number[]).includes(v), "Invalid cooldown"),
  overwrite_notifications: z.string().optional().transform((v) => v === "on"),
  comment_notifications: z.string().optional().transform((v) => v === "on"),
});

export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const config = await getNotificationConfig(ctx.org.id);
  return render("pages/org-notifications.njk", {
    config,
    ctx,
    activePage: "org-notifications",
  });
}

export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const formData = await req.formData();
  const result = NotificationConfigSchema.safeParse({
    untranslated_threshold: formData.get("untranslated_threshold"),
    email_cooldown_hours: formData.get("email_cooldown_hours"),
    overwrite_notifications: formData.get("overwrite_notifications"),
    comment_notifications: formData.get("comment_notifications"),
  });

  if (!result.success) {
    const config = await getNotificationConfig(ctx.org.id);
    return render("pages/org-notifications.njk", {
      config,
      error: "Invalid settings. Please check your values.",
      ctx,
      activePage: "org-notifications",
    }, 422);
  }

  const config = result.data;

  await sql`
    UPDATE organizations
    SET notification_config = ${JSON.stringify(config)}
    WHERE id = ${ctx.org.id}
  `;

  const updatedConfig = await getNotificationConfig(ctx.org.id);

  return render("pages/org-notifications.njk", {
    config: updatedConfig,
    success: "Notification settings saved",
    ctx,
    activePage: "org-notifications",
  });
}
