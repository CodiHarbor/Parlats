export interface Preset {
  path: string;
  format: "json-nested" | "json-flat";
  description: string;
}

export const PRESETS: Record<string, Preset> = {
  "next-intl": {
    path: "messages/{locale}.json",
    format: "json-nested",
    description: "Next.js with next-intl (App Router)",
  },
  i18next: {
    path: "public/locales/{locale}/{namespace}.json",
    format: "json-nested",
    description: "i18next / react-i18next",
  },
  "next-i18next": {
    path: "public/locales/{locale}/{namespace}.json",
    format: "json-nested",
    description: "next-i18next (Pages Router)",
  },
  "react-intl": {
    path: "lang/{locale}.json",
    format: "json-flat",
    description: "react-intl / FormatJS",
  },
  "vue-i18n": {
    path: "src/locales/{locale}.json",
    format: "json-nested",
    description: "Vue.js with vue-i18n",
  },
};

export function expandPath(
  pattern: string,
  locale: string,
  namespace?: string
): string {
  let result = pattern.replace("{locale}", locale);
  if (namespace) {
    result = result.replace("{namespace}", namespace);
  }
  return result;
}

export function hasNamespacePlaceholder(pattern: string): boolean {
  return pattern.includes("{namespace}");
}
