const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

export function info(msg: string): void {
  console.log(`${CYAN}info${RESET} ${msg}`);
}

export function success(msg: string): void {
  console.log(`${GREEN}done${RESET} ${msg}`);
}

export function warn(msg: string): void {
  console.error(`${YELLOW}warn${RESET} ${msg}`);
}

export function error(msg: string): void {
  console.error(`${RED}error${RESET} ${msg}`);
}

export function dim(msg: string): string {
  return `${DIM}${msg}${RESET}`;
}

export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] || "").length))
  );
  const line = (cols: string[]) =>
    cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(dim(line(headers)));
  for (const row of rows) {
    console.log(line(row));
  }
}
