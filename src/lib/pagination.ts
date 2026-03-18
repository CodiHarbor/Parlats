/** Build a pagination window with ellipsis gaps for large page counts.
 *  Returns an array of page numbers and nulls (null = ellipsis).
 *  Always shows first, last, and current ± delta pages. */
export function paginationWindow(current: number, total: number, delta = 2): (number | null)[] {
  if (total <= 1) return [];
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const range: number[] = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
      range.push(i);
    }
  }

  const result: (number | null)[] = [];
  let prev = 0;
  for (const page of range) {
    if (page - prev > 1) result.push(null);
    result.push(page);
    prev = page;
  }
  return result;
}
