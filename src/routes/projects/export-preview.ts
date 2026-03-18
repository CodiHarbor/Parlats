import type { AuthenticatedContext } from "../../types/index.ts";
import type { FileFormat } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";
import { sql } from "../../db/client.ts";
import { buildPreviewData } from "./export.ts";

/** POST /projects/:id/export/preview — return HTML preview table */
export async function POST(req: Request, ctx: AuthenticatedContext): Promise<Response> {
  const [project] = await sql`
    SELECT * FROM projects WHERE id = ${ctx.params.id} AND org_id = ${ctx.org.id}
  `;
  if (!project) {
    return render("partials/export-preview.njk", { error: "Project not found", rows: [], columns: [], page: 1, totalPages: 1, totalRows: 0, projectId: "" });
  }

  const formData = await req.formData();
  const format = (formData.get("format") as FileFormat) || "json-nested";
  const namespaceIds = formData.getAll("namespaces[]") as string[];
  const languageCodes = formData.getAll("languages[]") as string[];
  const onlyMissing = formData.get("only_missing") === "1";

  // Page from query string
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;

  try {
    const preview = await buildPreviewData(
      project.id,
      format,
      namespaceIds,
      languageCodes,
      onlyMissing,
      page,
    );

    return render("partials/export-preview.njk", {
      ...preview,
      projectId: project.id,
      ctx,
    });
  } catch (err) {
    console.error("Export preview error:", err);
    return render("partials/export-preview.njk", {
      error: "Failed to generate preview",
      rows: [],
      columns: [],
      page: 1,
      totalPages: 1,
      totalRows: 0,
      projectId: project.id,
      ctx,
    });
  }
}
