/** User roles within an organization */
export type OrgRole = "owner" | "admin" | "dev" | "translator";

/** Interpolation format for a project */
export type InterpolationFormat = "auto" | "i18next" | "icu" | "custom";

/** File format for import/export */
export type FileFormat = "json-nested" | "json-flat" | "csv" | "yaml" | "xlsx";

/** Change operation types */
export type ChangeType =
  | "edit"
  | "import_json"
  | "import_csv"
  | "import_yaml"
  | "import_xlsx"
  | "batch_add"
  | "batch_delete"
  | "ai_translate"
  | "urgent_push";

/** Change detail actions */
export type ChangeAction = "created" | "updated" | "deleted";

/** Notification types */
export type NotificationType =
  | "untranslated_threshold"
  | "translation_overwritten"
  | "comment_added";

/** Request context built by router + middleware */
export interface RequestContext {
  params: Record<string, string>;
  query: URLSearchParams;
  user?: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    locale?: string | null;
    emailVerified?: boolean;
  };
  org?: {
    id: string;
    name: string;
    slug: string;
    role: OrgRole;
    subscriptionStatus?: string;
  };
  userOrgs?: Array<{
    id: string;
    name: string;
    slug: string;
    role: OrgRole;
  }>;
  apiKey?: {
    id: string;
    scopes: { projects: string[]; permissions: string[] };
    rateLimit: number;
  };
  locale?: string;
  t?: (key: string, params?: Record<string, string | number>) => string;
  nonce?: string;
}

/** Context guaranteed to have auth — use in handlers behind auth middleware */
export interface AuthenticatedContext extends RequestContext {
  user: NonNullable<RequestContext["user"]>;
  org: NonNullable<RequestContext["org"]>;
  locale: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/** Context guaranteed to have API key auth — use in handlers behind apiAuth middleware */
export interface ApiAuthenticatedContext extends RequestContext {
  user: NonNullable<RequestContext["user"]>;
  org: NonNullable<RequestContext["org"]>;
  apiKey: NonNullable<RequestContext["apiKey"]>;
}
