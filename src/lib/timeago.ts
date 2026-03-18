/** Format a date as a human-readable relative time string */
export function timeago(dateStr: string | Date, locale = "en"): string {
  const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins === 1) return "1 minute ago";
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;

  const timeStr = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

  if (diffDays === 1 || (diffDays === 0 && date.getDate() !== now.getDate())) {
    return `Yesterday at ${timeStr}`;
  }

  return date.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" }) + ` at ${timeStr}`;
}
