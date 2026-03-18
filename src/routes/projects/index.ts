import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { slugify } from "../../lib/slug.ts";
import { paginationWindow } from "../../lib/pagination.ts";
import { z } from "zod/v4";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

const PAGE_SIZE = 50;

const CreateProject = z.object({
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().max(2000).default(""),
  default_language: z.string().min(2).max(10).default("en"),
  interpolation_format: z.enum(["auto", "i18next", "icu"]).default("auto"),
});

/** GET /projects — list all projects in the org */
export async function GET(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM projects WHERE org_id = ${ctx.org.id}
  `;
  const totalProjects = Number(count);
  const totalPages = Math.max(1, Math.ceil(totalProjects / PAGE_SIZE));

  const projects = await sql`
    SELECT p.id, p.name, p.slug, p.description, p.default_language,
      p.created_at, p.updated_at,
      COUNT(DISTINCT pl.language_code)::int AS language_count,
      COUNT(DISTINCT tk.id)::int AS key_count
    FROM projects p
    LEFT JOIN project_languages pl ON pl.project_id = p.id
    LEFT JOIN namespaces ns ON ns.project_id = p.id
    LEFT JOIN translation_keys tk ON tk.namespace_id = ns.id
    WHERE p.org_id = ${ctx.org.id}
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;

  return render("pages/projects.njk", {
    projects,
    page,
    totalPages,
    totalProjects,
    pageWindow: paginationWindow(page, totalPages),
    ctx,
    activePage: "projects",
  });
}

/** POST /projects — create a new project */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  // Only admin+ can create projects
  if (ctx.org.role !== "owner" && ctx.org.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const formData = await req.formData();
  const raw = {
    name: formData.get("name") as string || "",
    description: formData.get("description") as string || "",
    default_language: formData.get("default_language") as string || "en",
    interpolation_format: formData.get("interpolation_format") as string || "auto",
  };

  const result = CreateProject.safeParse(raw);

  if (!result.success) {
    return render("pages/project-new.njk", {
      errors: result.error.format(),
      values: raw,
      ctx,
      activePage: "projects",
    }, 422);
  }

  const { name, description, default_language, interpolation_format } = result.data;
  const slug = slugify(name);

  // Check slug uniqueness within org
  const existing = await sql`
    SELECT id FROM projects WHERE org_id = ${ctx.org.id} AND slug = ${slug}
  `;

  if (existing.length > 0) {
    return render("pages/project-new.njk", {
      errors: { name: { _errors: ["A project with this name already exists"] } },
      values: raw,
      ctx,
      activePage: "projects",
    }, 422);
  }

  const [project] = await sql`
    INSERT INTO projects (org_id, name, slug, description, default_language, interpolation_format)
    VALUES (${ctx.org.id}, ${name}, ${slug}, ${description}, ${default_language}, ${interpolation_format})
    RETURNING id
  `;

  // Auto-create default namespace, set as project default, and add default language
  const [defaultNs] = await sql`
    INSERT INTO namespaces (project_id, name, sort_order)
    VALUES (${project.id}, 'default', 0)
    RETURNING id
  `;

  await sql`
    UPDATE projects SET default_namespace_id = ${defaultNs.id}
    WHERE id = ${project.id}
  `;

  await sql`
    INSERT INTO project_languages (project_id, language_code, label)
    VALUES (${project.id}, ${default_language}, ${default_language})
  `;

  captureBusinessEvent("project_created", ctx, { project_id: project.id });

  return Response.redirect(`/projects/${project.id}`, 303);
}
