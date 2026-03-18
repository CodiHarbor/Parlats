import type { RequestContext } from "../types/index.ts";

export function GET(_req: Request, _ctx: RequestContext): Response {
  return Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
