import type { AuthenticatedContext } from "../../types/index.ts";
import { render } from "../../lib/templates.ts";

/** GET /projects/new — show create project form */
export function GET(_req: Request, ctx: AuthenticatedContext): Response {
  return render("pages/project-new.njk", {
    values: { name: "", description: "", default_language: "en" },
    ctx,
    activePage: "projects",
  });
}
