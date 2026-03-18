import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiSuccess, apiError } from "../../../lib/api-helpers.ts";

/** POST /api/v1/projects/:id/languages — add a language to the project */
export async function POST(req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const projectId = ctx.params.id;

  const [project] = await sql`
    SELECT id FROM projects
    WHERE id = ${projectId} AND org_id = ${ctx.org.id}
  `;
  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  let body: { language_code?: string };
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const languageCode = (body.language_code || "").trim();
  if (!languageCode || languageCode.length > 50) {
    return apiError("VALIDATION_ERROR", "Missing or invalid 'language_code'", 400);
  }

  await sql`
    INSERT INTO project_languages (project_id, language_code, label)
    VALUES (${projectId}, ${languageCode}, ${languageCode})
    ON CONFLICT (project_id, language_code) DO NOTHING
  `;

  return apiSuccess({ language_code: languageCode });
}
