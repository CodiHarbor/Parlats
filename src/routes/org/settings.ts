import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

/** GET /org/settings — show org settings form */
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [org] = await sql`
    SELECT id, name, slug, logo_url
    FROM organizations
    WHERE id = ${ctx.org.id}
  `;

  return render("pages/org-settings.njk", {
    org,
    ctx,
    activePage: "settings",
  });
}

/** POST /org/settings — update org name, slug, logo */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const form = await req.formData();
  const name = (form.get("name") as string || "").trim();
  const slug = (form.get("slug") as string || "").trim().toLowerCase();
  const logoUrl = (form.get("logo_url") as string || "").trim();

  // Validate logo URL protocol (prevent javascript: XSS)
  if (logoUrl) {
    try {
      const parsed = new URL(logoUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return renderWithError(ctx, { name, slug, logoUrl }, "Logo URL must use http or https protocol.");
      }
    } catch {
      return renderWithError(ctx, { name, slug, logoUrl }, "Logo URL must be a valid URL.");
    }
  }

  // Validation
  if (!name || name.length > 255) {
    return renderWithError(ctx, { name, slug, logoUrl }, "Organization name is required (max 255 characters).");
  }

  if (!slug || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || slug.length < 2 || slug.length > 100) {
    return renderWithError(ctx, { name, slug, logoUrl }, "Slug must be 2–100 characters, lowercase letters, numbers, and hyphens only.");
  }

  // Check slug uniqueness (excluding current org)
  const [existing] = await sql`
    SELECT id FROM organizations WHERE slug = ${slug} AND id != ${ctx.org.id}
  `;
  if (existing) {
    return renderWithError(ctx, { name, slug, logoUrl }, "This slug is already taken by another organization.");
  }

  await sql`
    UPDATE organizations
    SET name = ${name}, slug = ${slug}, logo_url = ${logoUrl || null}, updated_at = NOW()
    WHERE id = ${ctx.org.id}
  `;

  captureBusinessEvent("org_settings_updated", ctx);

  // Re-fetch to show updated values
  const [org] = await sql`
    SELECT id, name, slug, logo_url
    FROM organizations
    WHERE id = ${ctx.org.id}
  `;

  return render("pages/org-settings.njk", {
    org,
    ctx: { ...ctx, org: { ...ctx.org, name: org.name, slug: org.slug } },
    activePage: "settings",
    success: "Organization settings updated.",
  });
}

function renderWithError(
  ctx: AuthenticatedContext,
  values: { name: string; slug: string; logoUrl: string },
  error: string,
): Response {
  return render("pages/org-settings.njk", {
    org: { id: ctx.org.id, name: values.name, slug: values.slug, logo_url: values.logoUrl },
    ctx,
    activePage: "settings",
    error,
  });
}
