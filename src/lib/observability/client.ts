import { PostHog } from "posthog-node";
import { loadObservabilityConfig } from "./config.ts";

interface PostHogLike {
  capture(params: { distinctId: string; event: string; properties?: Record<string, any> }): void;
  shutdown(): Promise<void>;
}

const noopClient: PostHogLike = {
  capture() {},
  async shutdown() {},
};

let client: PostHogLike | null = null;

export function createPostHogClient(): PostHogLike {
  const config = loadObservabilityConfig();
  if (!config.isEnabled) {
    return noopClient;
  }
  return new PostHog(config.posthog.api_key, {
    host: config.posthog.host,
    flushAt: 20,
    flushInterval: 10000,
  });
}

export function getPostHogClient(): PostHogLike {
  if (!client) {
    client = createPostHogClient();
  }
  return client;
}

export async function shutdownPostHog(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
