export type DiffStatus = "new" | "changed" | "unchanged";

export interface DiffRow {
  key: string;
  status: DiffStatus;
  oldValue: string | null;
  newValue: string;
}

const STATUS_ORDER: Record<DiffStatus, number> = { new: 0, changed: 1, unchanged: 2 };

/**
 * Compare incoming parsed translations against existing DB state.
 * Both inputs are flat Map<key, value>.
 * Returns rows sorted: new first, then changed, then unchanged.
 */
export function computeDiff(
  incoming: Map<string, string>,
  existing: Map<string, string>,
): DiffRow[] {
  const rows: DiffRow[] = [];

  for (const [key, newValue] of incoming) {
    const oldValue = existing.get(key) ?? null;

    if (oldValue === null) {
      rows.push({ key, status: "new", oldValue: null, newValue });
    } else if (oldValue !== newValue) {
      rows.push({ key, status: "changed", oldValue, newValue });
    } else {
      rows.push({ key, status: "unchanged", oldValue, newValue });
    }
  }

  rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.key.localeCompare(b.key));
  return rows;
}

/** A single cell in the bulk diff: namespace + key + language + value */
export interface BulkDiffRow {
  namespace: string;
  key: string;
  language: string;
  status: DiffStatus;
  oldValue: string | null;
  newValue: string;
}

/**
 * Compute diff for a multi-language, multi-namespace import.
 * `incoming`: Map<namespace, Map<key, Map<language, value>>>
 * `existing`: Map<"ns:key:lang", value> — flat lookup from DB
 */
export function computeBulkDiff(
  incoming: Map<string, Map<string, Map<string, string>>>,
  existing: Map<string, string>,
): BulkDiffRow[] {
  const rows: BulkDiffRow[] = [];

  for (const [ns, keys] of incoming) {
    for (const [key, langs] of keys) {
      for (const [language, newValue] of langs) {
        if (!newValue) continue; // skip empty values
        const lookupKey = `${ns}:${key}:${language}`;
        const oldValue = existing.get(lookupKey) ?? null;

        let status: DiffStatus;
        if (oldValue === null) status = "new";
        else if (oldValue !== newValue) status = "changed";
        else status = "unchanged";

        rows.push({ namespace: ns, key, language, status, oldValue, newValue });
      }
    }
  }

  rows.sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || a.namespace.localeCompare(b.namespace)
    || a.key.localeCompare(b.key)
    || a.language.localeCompare(b.language),
  );
  return rows;
}
