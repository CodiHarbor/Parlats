import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

export interface ObservabilityConfig {
  posthog: {
    enabled: boolean;
    api_key: string;
    host: string;
  };
  logging: {
    http_requests: boolean;
    http_errors: boolean;
    db_queries: boolean;
    auth_events: boolean;
    business_events: boolean;
    background_jobs: boolean;
    rate_limit_hits: boolean;
    slow_request_threshold_ms: number;
  };
  isEnabled: boolean;
}

const DEFAULT_CONFIG: ObservabilityConfig = {
  posthog: { enabled: true, api_key: "", host: "https://us.i.posthog.com" },
  logging: {
    http_requests: true,
    http_errors: true,
    db_queries: false,
    auth_events: true,
    business_events: true,
    background_jobs: true,
    rate_limit_hits: true,
    slow_request_threshold_ms: 2000,
  },
  isEnabled: false,
};

let cachedConfig: ObservabilityConfig | null = null;

export function loadObservabilityConfig(): ObservabilityConfig {
  if (cachedConfig) return cachedConfig;

  let config = { ...DEFAULT_CONFIG, posthog: { ...DEFAULT_CONFIG.posthog }, logging: { ...DEFAULT_CONFIG.logging } };

  try {
    const configPath = resolve("config/observability.yml");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = yaml.load(raw) as any;

    if (parsed?.posthog) {
      config.posthog = { ...config.posthog, ...parsed.posthog };
    }
    if (parsed?.logging) {
      config.logging = { ...config.logging, ...parsed.logging };
    }
  } catch {
    // Config file not found or invalid — use defaults
  }

  // Env vars override YAML
  const envKey = process.env.POSTHOG_API_KEY;
  if (envKey) {
    config.posthog.api_key = envKey;
  }
  const envHost = process.env.POSTHOG_HOST;
  if (envHost) {
    config.posthog.host = envHost;
  }

  config.isEnabled = config.posthog.enabled && config.posthog.api_key.length > 0;

  cachedConfig = config;
  return config;
}

/** Reset cached config (for testing) */
export function resetConfigCache(): void {
  cachedConfig = null;
}
