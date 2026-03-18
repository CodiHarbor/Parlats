// src/lib/notifications.ts
import { sql } from "../db/client.ts";
import type { NotificationType } from "../types/index.ts";

export interface CreateNotificationOpts {
  orgId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  projectId?: string | null;
  translationKeyId?: string | null;
}

export interface Notification {
  id: string;
  org_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  project_id: string | null;
  translation_key_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** Default notification config values */
const DEFAULTS = {
  untranslated_threshold: 20,
  email_cooldown_hours: 24,
  overwrite_notifications: true,
  comment_notifications: true,
};

/** Read notification config from org, applying defaults for missing keys */
export async function getNotificationConfig(orgId: string) {
  const [org] = await sql`
    SELECT notification_config FROM organizations WHERE id = ${orgId}
  `;
  const config = (org?.notification_config as Record<string, unknown>) ?? {};
  return {
    untranslated_threshold:
      typeof config.untranslated_threshold === "number"
        ? config.untranslated_threshold
        : DEFAULTS.untranslated_threshold,
    email_cooldown_hours:
      typeof config.email_cooldown_hours === "number"
        ? config.email_cooldown_hours
        : DEFAULTS.email_cooldown_hours,
    overwrite_notifications:
      typeof config.overwrite_notifications === "boolean"
        ? config.overwrite_notifications
        : DEFAULTS.overwrite_notifications,
    comment_notifications:
      typeof config.comment_notifications === "boolean"
        ? config.comment_notifications
        : DEFAULTS.comment_notifications,
  };
}

/** Create a single notification */
export async function createNotification(opts: CreateNotificationOpts): Promise<string> {
  const [row] = await sql`
    INSERT INTO notifications (org_id, user_id, type, title, body, project_id, translation_key_id)
    VALUES (
      ${opts.orgId}, ${opts.userId}, ${opts.type}, ${opts.title}, ${opts.body},
      ${opts.projectId ?? null}, ${opts.translationKeyId ?? null}
    )
    RETURNING id
  `;
  return row.id;
}

/** Create notifications for multiple recipients in a single transaction */
export async function createBulkNotifications(opts: CreateNotificationOpts[]): Promise<void> {
  if (opts.length === 0) return;
  await sql.begin(async (tx) => {
    for (const o of opts) {
      await tx`
        INSERT INTO notifications (org_id, user_id, type, title, body, project_id, translation_key_id)
        VALUES (
          ${o.orgId}, ${o.userId}, ${o.type}, ${o.title}, ${o.body},
          ${o.projectId ?? null}, ${o.translationKeyId ?? null}
        )
      `;
    }
  });
}

/** Get unread notification count for a user */
export async function getUnreadCount(orgId: string, userId: string): Promise<number> {
  const [row] = await sql`
    SELECT count(*)::int AS count FROM notifications
    WHERE org_id = ${orgId} AND user_id = ${userId} AND read_at IS NULL
  `;
  return row.count;
}

/** Get notifications for a user with optional type filter and pagination */
export async function getNotifications(
  orgId: string,
  userId: string,
  filters: { type?: string; limit: number; offset: number },
): Promise<Notification[]> {
  if (filters.type) {
    return sql`
      SELECT * FROM notifications
      WHERE org_id = ${orgId} AND user_id = ${userId} AND type = ${filters.type}
      ORDER BY created_at DESC
      LIMIT ${filters.limit} OFFSET ${filters.offset}
    `;
  }
  return sql`
    SELECT * FROM notifications
    WHERE org_id = ${orgId} AND user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${filters.limit} OFFSET ${filters.offset}
  `;
}

/** Mark a single notification as read */
export async function markAsRead(orgId: string, userId: string, notificationId: string): Promise<void> {
  await sql`
    UPDATE notifications SET read_at = NOW()
    WHERE id = ${notificationId} AND org_id = ${orgId} AND user_id = ${userId} AND read_at IS NULL
  `;
}

/** Mark all notifications as read for a user */
export async function markAllAsRead(orgId: string, userId: string): Promise<void> {
  await sql`
    UPDATE notifications SET read_at = NOW()
    WHERE org_id = ${orgId} AND user_id = ${userId} AND read_at IS NULL
  `;
}

/** Hard-delete a notification */
export async function dismissNotification(orgId: string, userId: string, notificationId: string): Promise<void> {
  await sql`
    DELETE FROM notifications
    WHERE id = ${notificationId} AND org_id = ${orgId} AND user_id = ${userId}
  `;
}
