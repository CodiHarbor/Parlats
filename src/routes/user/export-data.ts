import type { AuthenticatedContext } from "../../types/index.ts";
import { sql } from "../../db/client.ts";

/** GET /user/export-data — GDPR data portability: download all user data as JSON */
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const userId = ctx.user.id;

  // Fetch all user-related data in parallel
  const [
    [profile],
    providers,
    memberships,
    comments,
    changeOperations,
    apiKeys,
    notifications,
  ] = await Promise.all([
    sql`SELECT id, email, name, avatar_url, locale, email_verified, digest_optout, created_at, updated_at
        FROM users WHERE id = ${userId}`,
    sql`SELECT provider, provider_id, created_at
        FROM user_providers WHERE user_id = ${userId}`,
    sql`SELECT o.name AS org_name, o.slug AS org_slug, om.role, om.created_at
        FROM org_members om JOIN organizations o ON o.id = om.org_id
        WHERE om.user_id = ${userId}`,
    sql`SELECT c.body, c.language_code, c.created_at, tk.key AS key_name, p.name AS project_name
        FROM comments c
        JOIN translation_keys tk ON tk.id = c.translation_key_id
        JOIN namespaces n ON n.id = tk.namespace_id
        JOIN projects p ON p.id = n.project_id
        WHERE c.user_id = ${userId}
        ORDER BY c.created_at DESC`,
    sql`SELECT type, summary, created_at
        FROM change_operations WHERE user_id = ${userId}
        ORDER BY created_at DESC LIMIT 500`,
    sql`SELECT name, key_prefix, scopes, rate_limit, last_used_at, created_at, revoked_at
        FROM api_keys WHERE created_by = ${userId}`,
    sql`SELECT type, title, body, read_at, created_at
        FROM notifications WHERE user_id = ${userId}
        ORDER BY created_at DESC LIMIT 500`,
  ]);

  const data = {
    exported_at: new Date().toISOString(),
    profile: {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      avatar_url: profile.avatar_url,
      locale: profile.locale,
      email_verified: profile.email_verified,
      digest_optout: profile.digest_optout,
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    },
    oauth_providers: providers.map((p: any) => ({
      provider: p.provider,
      provider_id: p.provider_id,
      connected_at: p.created_at,
    })),
    organization_memberships: memberships.map((m: any) => ({
      organization: m.org_name,
      slug: m.org_slug,
      role: m.role,
      joined_at: m.created_at,
    })),
    comments: comments.map((c: any) => ({
      project: c.project_name,
      key: c.key_name,
      language: c.language_code,
      body: c.body,
      created_at: c.created_at,
    })),
    change_history: changeOperations.map((o: any) => ({
      type: o.type,
      summary: o.summary,
      created_at: o.created_at,
    })),
    api_keys: apiKeys.map((k: any) => ({
      name: k.name,
      prefix: k.key_prefix,
      scopes: k.scopes,
      rate_limit: k.rate_limit,
      last_used_at: k.last_used_at,
      created_at: k.created_at,
      revoked_at: k.revoked_at,
    })),
    notifications: notifications.map((n: any) => ({
      type: n.type,
      title: n.title,
      body: n.body,
      read_at: n.read_at,
      created_at: n.created_at,
    })),
  };

  const json = JSON.stringify(data, null, 2);
  const filename = `parlats-data-${profile.email.replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().slice(0, 10)}.json`;

  return new Response(json, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
