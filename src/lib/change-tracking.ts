// src/lib/change-tracking.ts
import { sql } from "../db/client.ts";
import type { ChangeType } from "../types/index.ts";

export interface ChangeDetail {
  keyId: string | null;
  keyName: string;
  languageCode: string;
  action: "created" | "updated" | "deleted";
  oldValue: string | null;
  newValue: string | null;
}

/**
 * Record a change operation with its details inside an existing transaction.
 * Pass `tx` from a sql.begin() block, or use `sql` for auto-commit.
 */
export async function recordChange(
  tx: typeof sql,
  opts: {
    orgId: string;
    projectId: string;
    userId: string;
    type: ChangeType;
    summary: string;
    metadata?: Record<string, unknown>;
    details: ChangeDetail[];
  },
): Promise<string> {
  const [operation] = await tx`
    INSERT INTO change_operations (org_id, project_id, user_id, type, summary, metadata)
    VALUES (
      ${opts.orgId}, ${opts.projectId}, ${opts.userId},
      ${opts.type}, ${opts.summary},
      ${JSON.stringify(opts.metadata ?? {})}
    )
    RETURNING id
  `;

  for (const d of opts.details) {
    await tx`
      INSERT INTO change_details (operation_id, key_id, key_name, language_code, action, old_value, new_value)
      VALUES (${operation.id}, ${d.keyId}, ${d.keyName}, ${d.languageCode}, ${d.action}, ${d.oldValue}, ${d.newValue})
    `;
  }

  return operation.id;
}
