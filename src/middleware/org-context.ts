import type { MiddlewareFn } from "../router.ts";
import { sql } from "../db/client.ts";

const DEV_ORG = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Parlats",
  slug: "parlats",
  role: "owner" as const,
  subscriptionStatus: "active",
};

export const orgContext: MiddlewareFn = async (_req, ctx, next) => {
  if (process.env.NODE_ENV === "development") {
    ctx.org = DEV_ORG;
    ctx.userOrgs = [{ id: DEV_ORG.id, name: DEV_ORG.name, slug: DEV_ORG.slug, role: DEV_ORG.role }];
    return next();
  }

  const session = (ctx as any)._session as
    | { activeOrgId: string | null }
    | undefined;

  if (!session?.activeOrgId) {
    const [membership] = await sql`
      SELECT om.org_id, om.role, o.name, o.slug, o.subscription_status
      FROM org_members om
      JOIN organizations o ON o.id = om.org_id
      WHERE om.user_id = ${ctx.user!.id}
      LIMIT 1
    `;

    if (!membership) {
      return new Response("No organization found", { status: 403 });
    }

    ctx.org = {
      id: membership.org_id,
      name: membership.name,
      slug: membership.slug,
      role: membership.role,
      subscriptionStatus: membership.subscription_status,
    };
  } else {
    const [membership] = await sql`
      SELECT om.role, o.name, o.slug, o.subscription_status
      FROM org_members om
      JOIN organizations o ON o.id = om.org_id
      WHERE om.user_id = ${ctx.user!.id} AND om.org_id = ${session.activeOrgId}
    `;

    if (!membership) {
      const [fallback] = await sql`
        SELECT om.org_id, om.role, o.name, o.slug, o.subscription_status
        FROM org_members om
        JOIN organizations o ON o.id = om.org_id
        WHERE om.user_id = ${ctx.user!.id}
        LIMIT 1
      `;

      if (!fallback) {
        return new Response("No organization found", { status: 403 });
      }

      ctx.org = {
        id: fallback.org_id,
        name: fallback.name,
        slug: fallback.slug,
        role: fallback.role,
        subscriptionStatus: fallback.subscription_status,
      };
    } else {
      ctx.org = {
        id: session.activeOrgId,
        name: membership.name,
        slug: membership.slug,
        role: membership.role,
        subscriptionStatus: membership.subscription_status,
      };
    }
  }

  // Fetch ALL orgs this user belongs to (for the org switcher)
  const allOrgs = await sql`
    SELECT om.org_id AS id, om.role, o.name, o.slug
    FROM org_members om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = ${ctx.user!.id}
    ORDER BY o.name
  `;
  ctx.userOrgs = allOrgs.map((o: any) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    role: o.role,
  }));

  return next();
};
