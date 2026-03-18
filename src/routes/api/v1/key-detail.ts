import type { ApiAuthenticatedContext } from "../../../types/index.ts";
import { sql } from "../../../db/client.ts";
import { apiSuccess, apiError } from "../../../lib/api-helpers.ts";
import { z } from "zod/v4";
import { recordChange } from "../../../lib/change-tracking.ts";
import { captureBusinessEvent } from "../../../lib/observability/capture.ts";

const UpdateKeySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  namespace: z.string().max(255).optional(),
});

/** PATCH /api/v1/projects/:id/keys/:keyId — update a translation key */
export async function PATCH(req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const { id: projectId, keyId } = ctx.params;

  const [project] = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND org_id = ${ctx.org.id}
  `;
  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  const [key] = await sql`
    SELECT tk.id, tk.key, tk.namespace_id, n.name AS namespace
    FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE tk.id = ${keyId} AND n.project_id = ${projectId}
  `;
  if (!key) return apiError("NOT_FOUND", "Key not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const result = UpdateKeySchema.safeParse(body);
  if (!result.success) {
    return apiError("VALIDATION_ERROR", result.error.issues.map(i => i.message).join(", "), 400);
  }

  const updates = result.data;

  await sql.begin(async (tx) => {
    if (updates.name) {
      await tx`UPDATE translation_keys SET key = ${updates.name} WHERE id = ${keyId}`;
    }

    if (updates.namespace) {
      let [ns] = await tx`
        SELECT id FROM namespaces
        WHERE project_id = ${projectId} AND name = ${updates.namespace}
      `;
      if (!ns) {
        [ns] = await tx`
          INSERT INTO namespaces (project_id, name, sort_order)
          VALUES (${projectId}, ${updates.namespace}, 0)
          RETURNING id
        `;
      }
      await tx`UPDATE translation_keys SET namespace_id = ${ns.id} WHERE id = ${keyId}`;
    }
  });

  const [updated] = await sql`
    SELECT tk.id, tk.key, tk.namespace_id, n.name AS namespace, tk.created_at
    FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE tk.id = ${keyId}
  `;

  return apiSuccess(updated);
}

/** DELETE /api/v1/projects/:id/keys/:keyId — delete a translation key */
export async function DELETE(_req: Request, ctx: ApiAuthenticatedContext): Promise<Response> {
  const { id: projectId, keyId } = ctx.params;

  const [project] = await sql`
    SELECT id FROM projects WHERE id = ${projectId} AND org_id = ${ctx.org.id}
  `;
  if (!project) return apiError("NOT_FOUND", "Project not found", 404);

  const [key] = await sql`
    SELECT tk.id, tk.key, n.name AS namespace
    FROM translation_keys tk
    JOIN namespaces n ON n.id = tk.namespace_id
    WHERE tk.id = ${keyId} AND n.project_id = ${projectId}
  `;
  if (!key) return apiError("NOT_FOUND", "Key not found", 404);

  await sql.begin(async (tx) => {
    await tx`DELETE FROM translation_keys WHERE id = ${keyId}`;

    await recordChange(tx, {
      orgId: ctx.org.id,
      projectId,
      userId: ctx.user.id,
      type: "batch_delete",
      summary: `API: Deleted key '${key.key}'`,
      details: [{
        keyId: null,
        keyName: key.key,
        languageCode: "",
        action: "deleted",
        oldValue: null,
        newValue: null,
      }],
    });
  });

  captureBusinessEvent("key_deleted", ctx, { project_id: ctx.params.id });
  return apiSuccess({ deleted: true });
}
