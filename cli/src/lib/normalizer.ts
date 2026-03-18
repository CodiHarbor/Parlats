function deepSort(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      sorted[key] = deepSort(val as Record<string, unknown>);
    } else {
      sorted[key] = val;
    }
  }
  return sorted;
}

export function normalizeJson(data: Record<string, unknown>): string {
  const sorted = deepSort(data);
  return JSON.stringify(sorted, null, 2);
}
