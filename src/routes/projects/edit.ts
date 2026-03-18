import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { slugify } from "../../lib/slug.ts";
import { z } from "zod/v4";
import { captureBusinessEvent } from "../../lib/observability/capture.ts";

const UpdateProject = z.object({
  name: z.string().min(1, "Name is required").max(255),
  description: z.string().max(2000).default(""),
  default_language: z.string().min(2).max(10),
  interpolation_format: z.enum(["auto", "i18next", "icu"]).default("auto"),
  default_namespace_id: z.string().uuid().optional().or(z.literal("")),
});

/** GET /projects/:id/edit — show edit form */
export async function GET(_req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  }

  const languages = await sql`
    SELECT language_code, label FROM project_languages
    WHERE project_id = ${project.id}
    ORDER BY language_code
  `;

  const namespaces = await sql`
    SELECT id, name FROM namespaces
    WHERE project_id = ${project.id}
    ORDER BY sort_order, name
  `;

  return render("pages/project-edit.njk", {
    project,
    languages,
    namespaces,
    values: {
      name: project.name,
      description: project.description,
      default_language: project.default_language,
      interpolation_format: project.interpolation_format,
      default_namespace_id: project.default_namespace_id,
    },
    ctx,
    activePage: "projects",
  });
}

/** POST /projects/:id/edit — update project */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects
    WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;

  if (!project) {
    return new Response("Project not found", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  }

  const formData = await req.formData();
  const raw = {
    name: formData.get("name") as string || "",
    description: formData.get("description") as string || "",
    default_language: formData.get("default_language") as string || project.default_language,
    interpolation_format: formData.get("interpolation_format") as string || project.interpolation_format,
    default_namespace_id: formData.get("default_namespace_id") as string || "",
  };

  const result = UpdateProject.safeParse(raw);

  if (!result.success) {
    const languages = await sql`
      SELECT language_code, label FROM project_languages
      WHERE project_id = ${project.id}
      ORDER BY language_code
    `;
    const namespaces = await sql`
      SELECT id, name FROM namespaces
      WHERE project_id = ${project.id}
      ORDER BY sort_order, name
    `;
    return render("pages/project-edit.njk", {
      project,
      languages,
      namespaces,
      errors: result.error.format(),
      values: raw,
      ctx,
      activePage: "projects",
    }, 422);
  }

  const { name, description, default_language, interpolation_format, default_namespace_id } = result.data;
  const slug = slugify(name);
  const defaultNamespaceIdValue = default_namespace_id && default_namespace_id !== "" ? default_namespace_id : null;

  // Check slug uniqueness (excluding self)
  const conflict = await sql`
    SELECT id FROM projects
    WHERE org_id = ${ctx.org.id} AND slug = ${slug} AND id != ${project.id}
  `;

  if (conflict.length > 0) {
    const languages = await sql`
      SELECT language_code, label FROM project_languages
      WHERE project_id = ${project.id}
      ORDER BY language_code
    `;
    const namespaces = await sql`
      SELECT id, name FROM namespaces
      WHERE project_id = ${project.id}
      ORDER BY sort_order, name
    `;
    return render("pages/project-edit.njk", {
      project,
      languages,
      namespaces,
      errors: { name: { _errors: ["A project with this name already exists"] } },
      values: raw,
      ctx,
      activePage: "projects",
    }, 422);
  }

  await sql`
    UPDATE projects
    SET name = ${name}, slug = ${slug}, description = ${description},
        default_language = ${default_language}, interpolation_format = ${interpolation_format},
        default_namespace_id = ${defaultNamespaceIdValue},
        updated_at = NOW()
    WHERE id = ${project.id} AND org_id = ${ctx.org.id}
  `;

  captureBusinessEvent("project_edited", ctx, { project_id: ctx.params.id });

  return Response.redirect(`/projects/${project.id}`, 303);
}
