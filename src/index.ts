import { handleRequest, addRoute, registerMiddleware } from "./router.ts";

// -- Middleware --
import { auth } from "./middleware/auth.ts";
import { orgContext } from "./middleware/org-context.ts";
import { locale } from "./middleware/locale.ts";
import { requireRole } from "./middleware/permissions.ts";
import { apiAuth, requireApiScope, checkProjectScope } from "./middleware/api-auth.ts";
import { rateLimit } from "./middleware/rate-limit.ts";
import { webRateLimit } from "./middleware/web-rate-limit.ts";
import { csrf } from "./middleware/csrf.ts";
import { subscriptionGuard } from "./middleware/subscription.ts";
import { loadTranslations } from "./lib/i18n.ts";
import { captureError } from "./lib/observability/capture.ts";
import { shutdownPostHog } from "./lib/observability/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { seedParlatsUI } from "./db/seed-parlatsui.ts";

registerMiddleware("auth", auth);
registerMiddleware("orgContext", orgContext);
registerMiddleware("locale", locale);
registerMiddleware("requireOwner", requireRole("owner"));
registerMiddleware("requireAdmin", requireRole("admin"));
registerMiddleware("requireDev", requireRole("dev"));
registerMiddleware("requireTranslator", requireRole("translator"));
registerMiddleware("apiAuth", apiAuth);
registerMiddleware("rateLimit", rateLimit);
registerMiddleware("webRateLimit", webRateLimit);
registerMiddleware("csrf", csrf);
registerMiddleware("requireApiRead", requireApiScope("read"));
registerMiddleware("requireApiWrite", requireApiScope("write"));
registerMiddleware("requireApiImport", requireApiScope("import"));
registerMiddleware("requireApiExport", requireApiScope("export"));
registerMiddleware("checkProjectScope", checkProjectScope);
registerMiddleware("subscription", subscriptionGuard);

// -- Routes --
import * as health from "./routes/health.ts";
import * as landing from "./routes/landing.ts";
import * as dashboard from "./routes/dashboard.ts";
import * as projects from "./routes/projects/index.ts";
import * as projectNew from "./routes/projects/new.ts";
import * as projectDetail from "./routes/projects/detail.ts";
import * as projectEdit from "./routes/projects/edit.ts";
import * as projectDelete from "./routes/projects/delete.ts";
import * as projectLanguages from "./routes/projects/languages.ts";
import * as projectLanguageDelete from "./routes/projects/language-delete.ts";
import * as projectNamespaces from "./routes/projects/namespaces.ts";
import * as projectNamespaceDelete from "./routes/projects/namespace-delete.ts";
import * as namespaceSetDefault from "./routes/projects/namespace-set-default.ts";
import * as editor from "./routes/projects/editor.ts";
import * as editorKeys from "./routes/projects/editor-keys.ts";
import * as translationEdit from "./routes/projects/translation-edit.ts";
import * as translationCell from "./routes/projects/translation-cell.ts";
import * as addTranslations from "./routes/projects/add-translations.ts";
import * as addTranslationsCheck from "./routes/projects/add-translations-check.ts";
import * as keyDelete from "./routes/projects/key-delete.ts";
import * as projectExport from "./routes/projects/export.ts";
import * as exportPreview from "./routes/projects/export-preview.ts";
import * as projectImport from "./routes/projects/import.ts";
import * as importDetect from "./routes/projects/import-detect.ts";
import * as importPreview from "./routes/projects/import-preview.ts";
import * as importApplyWizard from "./routes/projects/import-apply-wizard.ts";
import * as importApply from "./routes/projects/import-apply.ts";
import * as importApplyBulk from "./routes/projects/import-apply-bulk.ts";
import * as history from "./routes/projects/history.ts";
import * as historyDetail from "./routes/projects/history-detail.ts";
import * as comments from "./routes/projects/comments.ts";
import * as commentDelete from "./routes/projects/comment-delete.ts";
import * as orgMembers from "./routes/org/members.ts";
import * as memberRole from "./routes/org/member-role.ts";
import * as memberRemove from "./routes/org/member-remove.ts";
import * as invitations from "./routes/org/invitations.ts";
import * as invitationRevoke from "./routes/org/invitation-revoke.ts";
import * as orgApiKeys from "./routes/org/api-keys.ts";
import * as orgApiDocs from "./routes/org/api-docs.ts";
import * as orgSettings from "./routes/org/settings.ts";
import * as orgSwitch from "./routes/org/switch.ts";
import * as apiProjects from "./routes/api/v1/projects.ts";
import * as apiProjectDetail from "./routes/api/v1/project-detail.ts";
import * as apiKeys from "./routes/api/v1/keys.ts";
import * as apiKeyDetail from "./routes/api/v1/key-detail.ts";
import * as apiTranslations from "./routes/api/v1/translations.ts";
import * as apiTranslationUpdate from "./routes/api/v1/translation-update.ts";
import * as apiMissing from "./routes/api/v1/missing.ts";
import * as apiImport from "./routes/api/v1/import.ts";
import * as apiExport from "./routes/api/v1/export.ts";
import * as apiHistory from "./routes/api/v1/history.ts";
import * as apiLanguages from "./routes/api/v1/languages.ts";
import * as userLocale from "./routes/user/locale.ts";
import * as deleteAccount from "./routes/user/delete-account.ts";
import * as exportData from "./routes/user/export-data.ts";
import * as unsubscribe from "./routes/user/unsubscribe.ts";
import * as login from "./routes/auth/login.ts";
import * as authGoogle from "./routes/auth/google.ts";
import * as authGoogleCallback from "./routes/auth/google-callback.ts";
import * as authLogout from "./routes/auth/logout.ts";
import * as register from "./routes/auth/register.ts";
import * as verifyEmail from "./routes/auth/verify-email.ts";
import * as forgotPassword from "./routes/auth/forgot-password.ts";
import * as resetPassword from "./routes/auth/reset-password.ts";
import * as invitationAccept from "./routes/invitations/accept.ts";
import * as legal from "./routes/legal.ts";
import * as pricing from "./routes/pricing.ts";
import * as billingIndex from "./routes/billing/index.ts";
import * as billingCheckout from "./routes/billing/checkout.ts";
import * as billingSuccess from "./routes/billing/success.ts";
import * as billingWebhook from "./routes/billing/webhook.ts";
import * as billingPortal from "./routes/billing/portal.ts";

// Auth routes (no middleware — these are public/pre-auth)
addRoute("/login", login, ["webRateLimit", "csrf"]);
addRoute("/auth/google", authGoogle);
addRoute("/auth/google/callback", authGoogleCallback);
addRoute("/auth/logout", authLogout, ["csrf"]);
addRoute("/register", register, ["webRateLimit", "csrf"]);
addRoute("/auth/verify-email", verifyEmail);
addRoute("/auth/forgot-password", forgotPassword, ["webRateLimit", "csrf"]);
addRoute("/auth/reset-password", resetPassword, ["webRateLimit", "csrf"]);
addRoute("/invitations/accept", invitationAccept, ["webRateLimit", "csrf"]);

addRoute("/health", health);
addRoute("/", landing);
addRoute("/privacy", legal);
addRoute("/terms", legal);

// Public
addRoute("/pricing", pricing, ["locale", "csrf"]);

// Billing — webhook has NO auth, NO csrf (Stripe signature verification only)
addRoute("/billing/webhook", billingWebhook, []);

// Billing — authenticated routes
addRoute("/billing/checkout", billingCheckout, ["auth", "orgContext", "locale", "requireAdmin", "csrf"]);
addRoute("/billing/portal", billingPortal, ["auth", "orgContext", "locale", "requireAdmin", "csrf"]);
addRoute("/billing/success", billingSuccess, ["auth", "orgContext", "locale"]);
addRoute("/billing", billingIndex, ["auth", "orgContext", "locale", "requireAdmin", "csrf"]);

addRoute("/dashboard", dashboard, ["auth", "orgContext", "subscription", "locale", "csrf"]);

// Projects — admin+ for create/edit/delete, translator+ for view
addRoute("/projects", projects, ["auth", "orgContext", "subscription", "locale", "csrf"]);  // GET lists (all roles), POST creates (handler checks role)
addRoute("/projects/new", projectNew, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/projects/:id", projectDetail, ["auth", "orgContext", "subscription", "locale", "csrf"]);  // view OK for all
addRoute("/projects/:id/edit", projectEdit, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/projects/:id/delete", projectDelete, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/projects/:id/languages", projectLanguages, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/languages/:code/delete", projectLanguageDelete, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/namespaces", projectNamespaces, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/namespaces/:nsId/delete", projectNamespaceDelete, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/namespaces/:nsId/set-default", namespaceSetDefault, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);

// Editor
addRoute("/projects/:id/editor", editor, ["auth", "orgContext", "subscription", "locale", "csrf"]);
addRoute("/projects/:id/editor/keys", editorKeys, ["auth", "orgContext", "subscription", "locale", "csrf"]);
addRoute("/projects/:id/add-translations", addTranslations, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/add-translations/check-key", addTranslationsCheck, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/keys/:keyId/edit", translationEdit, ["auth", "orgContext", "subscription", "locale", "csrf"]);
addRoute("/projects/:id/keys/:keyId/translate", translationEdit, ["auth", "orgContext", "subscription", "locale", "csrf"]);
addRoute("/projects/:id/keys/:keyId/cell", translationCell, ["auth", "orgContext", "subscription", "locale", "csrf"]);
addRoute("/projects/:id/keys/:keyId/delete", keyDelete, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);

// Export & Import — dev+ for both
addRoute("/projects/:id/export", projectExport, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/export/preview", exportPreview, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/import", projectImport, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/import/detect", importDetect, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/import/preview", importPreview, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/import/apply-wizard", importApplyWizard, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/import/apply", importApply, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);
addRoute("/projects/:id/import/apply-bulk", importApplyBulk, ["auth", "orgContext", "subscription", "locale", "requireDev", "csrf"]);

// History
addRoute("/projects/:id/history", history, ["auth", "orgContext", "subscription", "locale", "csrf"]);
addRoute("/projects/:id/history/:operationId", historyDetail, ["auth", "orgContext", "subscription", "locale", "csrf"]);

// Comments
addRoute("/projects/:id/keys/:keyId/comments", comments, ["auth", "orgContext", "subscription", "locale", "csrf"]);
addRoute("/projects/:id/keys/:keyId/comments/:commentId/delete", commentDelete, ["auth", "orgContext", "subscription", "locale", "csrf"]);

// User preferences
addRoute("/user/locale", userLocale, ["auth", "orgContext", "subscription", "locale", "csrf"]);
addRoute("/user/delete-account", deleteAccount, ["auth", "orgContext", "subscription", "locale", "webRateLimit", "csrf"]);
addRoute("/user/export-data", exportData, ["auth", "orgContext", "subscription", "locale"]);
addRoute("/user/unsubscribe", unsubscribe);

// Org
addRoute("/org/members", orgMembers, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/org/members/:userId/role", memberRole, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/org/members/:userId/remove", memberRemove, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/org/invitations", invitations, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/org/invitations/:invitationId/revoke", invitationRevoke, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/org/api-keys", orgApiKeys, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/org/api-keys/:id", orgApiKeys, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/org/api-docs", orgApiDocs, ["auth", "orgContext", "subscription", "locale", "csrf"]);
addRoute("/org/settings", orgSettings, ["auth", "orgContext", "subscription", "locale", "requireAdmin", "csrf"]);
addRoute("/org/switch/:id", orgSwitch, ["auth", "orgContext", "subscription", "locale", "csrf"]);

// API v1
addRoute("/api/v1/projects", apiProjects, ["apiAuth", "rateLimit", "subscription", "requireApiRead"]);
addRoute("/api/v1/projects/:id", apiProjectDetail, ["apiAuth", "rateLimit", "subscription", "requireApiRead", "checkProjectScope"]);
addRoute("/api/v1/projects/:id/keys", apiKeys, ["apiAuth", "rateLimit", "subscription", "checkProjectScope"]);
addRoute("/api/v1/projects/:id/keys/:keyId", apiKeyDetail, ["apiAuth", "rateLimit", "subscription", "requireApiWrite", "checkProjectScope"]);
addRoute("/api/v1/projects/:id/translations", apiTranslations, ["apiAuth", "rateLimit", "subscription", "checkProjectScope"]);
addRoute("/api/v1/projects/:id/translations/:keyId", apiTranslationUpdate, ["apiAuth", "rateLimit", "subscription", "requireApiWrite", "checkProjectScope"]);
addRoute("/api/v1/projects/:id/missing/:lang", apiMissing, ["apiAuth", "rateLimit", "subscription", "requireApiRead", "checkProjectScope"]);
addRoute("/api/v1/projects/:id/languages", apiLanguages, ["apiAuth", "rateLimit", "subscription", "requireApiWrite", "checkProjectScope"]);
addRoute("/api/v1/projects/:id/import", apiImport, ["apiAuth", "rateLimit", "subscription", "requireApiImport", "checkProjectScope"]);
addRoute("/api/v1/projects/:id/export", apiExport, ["apiAuth", "rateLimit", "subscription", "requireApiExport", "checkProjectScope"]);
addRoute("/api/v1/projects/:id/history", apiHistory, ["apiAuth", "rateLimit", "subscription", "requireApiRead", "checkProjectScope"]);

// -- Startup --
await runMigrations();
await seedParlatsUI();
await loadTranslations();

// Guard: verify production mode has proper secrets configured
if (process.env.NODE_ENV === "production") {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn(
      "WARNING: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.\n" +
      "Google OAuth login will be unavailable. Email+password auth still works."
    );
  }
  const secret = process.env.SESSION_SECRET || "";
  if (!secret || secret === "dev-session-secret-change-in-production" || secret.length < 32) {
    console.error(
      "FATAL: NODE_ENV=production but SESSION_SECRET is weak or default.\n" +
      "Set SESSION_SECRET to a random string of at least 32 characters."
    );
    process.exit(1);
  }
}

// -- Crash handlers --
process.on("uncaughtException", async (err) => {
  console.error("Uncaught exception:", err);
  captureError("uncaught_exception", err, { type: "uncaughtException" });
  await shutdownPostHog();
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error("Unhandled rejection:", err);
  captureError("uncaught_exception", err, { type: "unhandledRejection" });
  await shutdownPostHog();
  process.exit(1);
});

// -- Server --
const server = Bun.serve({
  port: Number(process.env.PORT) || 3100,
  maxRequestBodySize: 10 * 1024 * 1024, // 10MB — file uploads are checked at 5MB separately
  fetch: handleRequest,
});

console.log(`Parlats running at http://localhost:${server.port}`);

