import { sql } from "../db/client.ts";
import { getNotificationConfig, createBulkNotifications } from "./notifications.ts";
import { sendEmail } from "./email.ts";
import { nunjucks } from "./templates.ts";
import { captureBackgroundJob } from "./observability/capture.ts";
import { generateUnsubscribeToken } from "../routes/user/unsubscribe.ts";

const APP_URL = Bun.env.APP_URL || "http://localhost:3100";

/**
 * Hourly digest job:
 * 1. Check untranslated thresholds → create notifications
 * 2. Collect unread notifications → send digest emails (respecting cooldown)
 * 3. Clean up old data
 */
export async function runDigestJob(): Promise<void> {
  console.log("[DIGEST] Starting hourly digest job...");

  const start = performance.now();
  let emailsSent = 0;
  let errorCount = 0;

  try {
    const orgs = await sql`SELECT id, name, notification_config FROM organizations`;

    for (const org of orgs) {
      try {
        await processOrgThresholds(org.id, org.name);
        const sent = await processOrgDigestEmails(org.id, org.name);
        emailsSent += sent;
      } catch (err) {
        console.error(`[DIGEST] Error processing org ${org.id}:`, err);
        errorCount++;
      }
    }

    await cleanupOldData();
    console.log("[DIGEST] Digest job complete.");
  } catch (err) {
    console.error("[DIGEST] Digest job failed:", err);
    errorCount++;
  } finally {
    captureBackgroundJob("digest_job_completed", {
      duration_ms: Math.round(performance.now() - start),
      emails_sent: emailsSent,
      errors: errorCount,
    });
  }
}

async function processOrgThresholds(orgId: string, _orgName: string): Promise<void> {
  const config = await getNotificationConfig(orgId);

  const gaps = await sql`
    SELECT
      p.id AS project_id,
      p.name AS project_name,
      pl.language_code,
      COUNT(tk.id)::int AS total_keys,
      COUNT(t.id)::int AS translated_count,
      (COUNT(tk.id) - COUNT(t.id))::int AS untranslated_count
    FROM projects p
    JOIN project_languages pl ON pl.project_id = p.id
    JOIN namespaces n ON n.project_id = p.id
    JOIN translation_keys tk ON tk.namespace_id = n.id
    LEFT JOIN translations t ON t.translation_key_id = tk.id AND t.language_code = pl.language_code AND t.value != ''
    WHERE p.org_id = ${orgId}
    GROUP BY p.id, p.name, pl.language_code
    HAVING (COUNT(tk.id) - COUNT(t.id)) > ${config.untranslated_threshold}
  `;

  if (gaps.length === 0) return;

  const members = await sql`
    SELECT user_id FROM org_members WHERE org_id = ${orgId}
  `;

  for (const gap of gaps) {
    const notifications = [];
    for (const member of members) {
      // Deduplication: skip if unread notification of same type for same project+language exists
      const escapedLang = gap.language_code.replace(/[%\\]/g, '\\$&');
      const [existing] = await sql`
        SELECT id FROM notifications
        WHERE org_id = ${orgId} AND user_id = ${member.user_id}
          AND type = 'untranslated_threshold'
          AND project_id = ${gap.project_id}
          AND body LIKE ${'%' + escapedLang + ' translation'} ESCAPE '\\'
          AND read_at IS NULL
        LIMIT 1
      `;
      if (existing) continue;

      notifications.push({
        orgId,
        userId: member.user_id,
        type: "untranslated_threshold" as const,
        title: `'${gap.project_name}' needs translations`,
        body: `${gap.untranslated_count} keys need ${gap.language_code} translation`,
        projectId: gap.project_id,
      });
    }

    if (notifications.length > 0) {
      await createBulkNotifications(notifications);
      console.log(`[DIGEST] Created ${notifications.length} threshold notifications for ${gap.project_name} (${gap.language_code})`);
    }
  }
}

async function processOrgDigestEmails(orgId: string, orgName: string): Promise<number> {
  const config = await getNotificationConfig(orgId);
  const cooldownMs = config.email_cooldown_hours * 60 * 60 * 1000;
  const cooldownDate = new Date(Date.now() - cooldownMs);

  const usersWithNotifications = await sql`
    SELECT DISTINCT user_id FROM notifications
    WHERE org_id = ${orgId} AND read_at IS NULL
  `;

  let sent = 0;

  for (const { user_id } of usersWithNotifications) {
    const [lastDigest] = await sql`
      SELECT sent_at FROM email_digest_log
      WHERE org_id = ${orgId} AND user_id = ${user_id}
      ORDER BY sent_at DESC
      LIMIT 1
    `;

    if (lastDigest && new Date(lastDigest.sent_at) > cooldownDate) {
      continue;
    }

    const [user] = await sql`SELECT email, name, digest_optout FROM users WHERE id = ${user_id}`;
    if (!user || user.digest_optout) continue;

    const notifications = await sql`
      SELECT * FROM notifications
      WHERE org_id = ${orgId} AND user_id = ${user_id} AND read_at IS NULL
      ORDER BY created_at DESC
      LIMIT 50
    `;

    if (notifications.length === 0) continue;

    const grouped: Record<string, typeof notifications> = {};
    for (const n of notifications) {
      if (!grouped[n.type]) grouped[n.type] = [];
      grouped[n.type].push(n);
    }

    const unsubscribeToken = await generateUnsubscribeToken(user_id);
    const unsubscribeUrl = `${APP_URL}/user/unsubscribe?token=${unsubscribeToken}`;

    const html = nunjucks.render("emails/digest.njk", {
      userName: user.name || user.email,
      orgName,
      grouped,
      totalCount: notifications.length,
      unsubscribeUrl,
    });

    await sendEmail({
      to: user.email,
      subject: `[Parlats] You have ${notifications.length} notification${notifications.length > 1 ? "s" : ""} in ${orgName}`,
      html,
    });

    // type='digest' — single cooldown across all notification types
    await sql`
      INSERT INTO email_digest_log (org_id, user_id, type, sent_at)
      VALUES (${orgId}, ${user_id}, 'digest', NOW())
    `;

    console.log(`[DIGEST] Sent digest email to ${user.email} (${notifications.length} notifications)`);
    sent++;
  }

  return sent;
}

async function cleanupOldData(): Promise<void> {
  await sql`DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '90 days'`;
  await sql`DELETE FROM email_digest_log WHERE sent_at < NOW() - INTERVAL '30 days'`;
  await sql`DELETE FROM sessions WHERE expires_at < NOW()`;
  await sql`DELETE FROM invitations WHERE expires_at < NOW() AND accepted = false`;
  await sql`DELETE FROM email_verifications WHERE expires_at < NOW()`;
  await sql`DELETE FROM password_resets WHERE expires_at < NOW()`;
  console.log(`[DIGEST] Cleanup: removed expired sessions, invitations, tokens, notifications, and digest logs`);
}
