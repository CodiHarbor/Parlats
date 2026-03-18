import { sql } from "../db/client.ts";

/** locale -> (key -> value) */
let store: Map<string, Map<string, string>> = new Map();

const SUPPORTED_LOCALES = ["en", "es", "fr", "de", "ja"];
const DEFAULT_LOCALE = "en";
const I18N_PROJECT_SLUG = "parlats-ui";
const I18N_ORG_SLUG = Bun.env.I18N_ORG_SLUG ?? "parlats";

/** Load all translations from the Parlats UI project into memory. */
export async function loadTranslations(): Promise<void> {
  try {
    const [project] = await sql`
      SELECT p.id FROM projects p
      JOIN organizations o ON o.id = p.org_id
      WHERE p.slug = ${I18N_PROJECT_SLUG} AND o.slug = ${I18N_ORG_SLUG}
    `;

    if (!project) {
      console.warn("[i18n] Parlats UI project not found — using key fallback");
      return;
    }

    const rows = await sql`
      SELECT t.language_code, tk.key, t.value
      FROM translations t
      JOIN translation_keys tk ON tk.id = t.translation_key_id
      JOIN namespaces n ON n.id = tk.namespace_id
      WHERE n.project_id = ${project.id}
        AND t.value IS NOT NULL AND t.value != ''
    `;

    const newStore = new Map<string, Map<string, string>>();
    for (const row of rows) {
      if (!newStore.has(row.language_code)) {
        newStore.set(row.language_code, new Map());
      }
      newStore.get(row.language_code)!.set(row.key, row.value);
    }

    store = newStore;
    const count = rows.length;
    const langs = [...newStore.keys()].join(", ");
    console.log(`[i18n] Loaded ${count} translations (${langs})`);
  } catch (err) {
    console.error("[i18n] Failed to load translations — using key fallback:", err);
  }
}

/** Create a translation function bound to a specific locale. */
export function makeT(locale: string) {
  return (key: string, params?: Record<string, string | number>): string => {
    const value = store.get(locale)?.get(key)
      ?? store.get(DEFAULT_LOCALE)?.get(key)
      ?? key;
    if (!params) return value;
    return value.replace(/\{\{(\w+)\}\}/g, (match, k) =>
      params[k] !== undefined ? String(params[k]) : match
    );
  };
}

/** Resolve the best locale from user preference and Accept-Language header. */
export function resolveLocale(
  userLocale: string | null | undefined,
  acceptLanguage: string | null,
): string {
  // 1. User preference
  if (userLocale && SUPPORTED_LOCALES.includes(userLocale)) {
    return userLocale;
  }
  // 2. Accept-Language header
  if (acceptLanguage) {
    const parts = acceptLanguage.split(",");
    for (const part of parts) {
      const lang = part.split(";")[0].trim().toLowerCase();
      if (SUPPORTED_LOCALES.includes(lang)) return lang;
      const prefix = lang.split("-")[0];
      if (SUPPORTED_LOCALES.includes(prefix)) return prefix;
    }
  }
  // 3. Default
  return DEFAULT_LOCALE;
}

export { SUPPORTED_LOCALES, DEFAULT_LOCALE };

/** Test-only: replace the translation store */
export function _setStore(s: Map<string, Map<string, string>>): void {
  store = s;
}
