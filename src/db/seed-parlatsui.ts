/**
 * Seed the Parlats UI project — creates the admin user, org, and inserts
 * all canonical i18n keys with translations for every supported language.
 *
 * Can be run standalone:  bun run src/db/seed-parlatsui.ts
 * Or imported:            import { seedParlatsUI } from "./seed-parlatsui.ts"
 */
import { sql } from "./client.ts";
import { I18N_NAMESPACES, I18N_KEY_COUNT } from "../lib/i18n-keys.ts";
import { TRANSLATIONS } from "../lib/i18n-translations.ts";

const ADMIN_USER_ID = "00000000-0000-0000-0000-000000000001";
const ORG_ID = "00000000-0000-0000-0000-000000000001";

const LANGS = ["en", "es", "fr", "de", "ja"] as const;
const LANG_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  ja: "Japanese",
};

export async function seedParlatsUI(verbose = false) {
  const log = verbose ? console.log.bind(console) : () => {};
  const start = performance.now();

  // ── Admin user & org ──────────────────────────────────────────────
  await sql`
    INSERT INTO users (id, email, name, avatar_url)
    VALUES (${ADMIN_USER_ID}, 'admin@parlats.local', 'Admin', NULL)
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${ORG_ID}, 'Parlats', 'parlats')
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO org_members (org_id, user_id, role)
    VALUES (${ORG_ID}, ${ADMIN_USER_ID}, 'owner')
    ON CONFLICT (org_id, user_id) DO NOTHING
  `;

  log("Admin user + org created.");

  // ── Parlats UI project ────────────────────────────────────────────
  const [project] = await sql`
    INSERT INTO projects (org_id, name, slug, description, default_language, interpolation_format)
    VALUES (${ORG_ID}, 'Parlats UI', 'parlats-ui', 'Translations for the Parlats interface', 'en', 'i18next')
    ON CONFLICT (org_id, slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;

  for (const lang of LANGS) {
    await sql`
      INSERT INTO project_languages (project_id, language_code, label)
      VALUES (${project.id}, ${lang}, ${LANG_LABELS[lang]})
      ON CONFLICT (project_id, language_code) DO NOTHING
    `;
  }

  // ── Keys & translations ───────────────────────────────────────────
  let totalKeys = 0;
  let totalTranslations = 0;

  for (let i = 0; i < I18N_NAMESPACES.length; i++) {
    const ns = I18N_NAMESPACES[i];
    const keyEntries = Object.entries(ns.keys);

    const [namespace] = await sql`
      INSERT INTO namespaces (project_id, name, sort_order)
      VALUES (${project.id}, ${ns.name}, ${i})
      ON CONFLICT (project_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
      RETURNING id
    `;

    // Batch-insert keys
    const batchSize = 50;
    for (let batch = 0; batch < keyEntries.length; batch += batchSize) {
      const slice = keyEntries.slice(batch, batch + batchSize);

      const insertedKeys = await sql`
        INSERT INTO translation_keys ${sql(
          slice.map(([key]) => ({
            namespace_id: namespace.id,
            key,
            description: "",
          }))
        )}
        ON CONFLICT (namespace_id, key) DO UPDATE SET key = EXCLUDED.key
        RETURNING id, key
      `;

      totalKeys += insertedKeys.length;

      // Build translation rows for all languages
      const translationRows: {
        translation_key_id: string;
        language_code: string;
        value: string;
        updated_by: string;
      }[] = [];

      for (const tk of insertedKeys) {
        // English from canonical keys
        const enValue = ns.keys[tk.key] || "";
        translationRows.push({
          translation_key_id: tk.id,
          language_code: "en",
          value: enValue,
          updated_by: ADMIN_USER_ID,
        });

        // Other languages from i18n-translations
        for (const lang of LANGS) {
          if (lang === "en") continue;
          const langMap = TRANSLATIONS[lang];
          if (langMap?.[tk.key]) {
            translationRows.push({
              translation_key_id: tk.id,
              language_code: lang,
              value: langMap[tk.key],
              updated_by: ADMIN_USER_ID,
            });
          }
        }
      }

      // Insert translations in sub-batches
      const txBatchSize = 200;
      for (let t = 0; t < translationRows.length; t += txBatchSize) {
        const txSlice = translationRows.slice(t, t + txBatchSize);
        await sql`
          INSERT INTO translations ${sql(txSlice)}
          ON CONFLICT (translation_key_id, language_code) DO UPDATE SET value = EXCLUDED.value
        `;
        totalTranslations += txSlice.length;
      }
    }

    log(`  ${ns.name}: ${keyEntries.length} keys`);
  }

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  console.log(
    `Parlats UI seeded: ${totalKeys}/${I18N_KEY_COUNT} keys, ${totalTranslations} translations (${elapsed}s)`,
  );
}

// Standalone execution
if (import.meta.main) {
  seedParlatsUI(true).then(() => process.exit(0)).catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
