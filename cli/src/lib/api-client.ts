export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface Project {
  id: string;
  name: string;
  slug?: string;
  languages: string[];
  namespaces: { id: string; name: string }[];
  stats: { key_count: number; translation_count: number };
}

export interface ProjectListItem {
  id: string;
  name: string;
  slug: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  total: number;
}

export class ParlatsClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(host: string, apiKey: string) {
    this.baseUrl = host.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  private async request(
    path: string,
    options: RequestInit = {},
    retries = 3,
    timeoutMs = 30_000
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new ApiError(0, "TIMEOUT", "Request timed out. Check your network and host URL.");
      }
      throw new ApiError(0, "NETWORK_ERROR", `Cannot connect to ${this.baseUrl}. Is the Parlats server running?`);
    }

    if (!response.ok) {
      let code = "UNKNOWN";
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error) {
          code = body.error.code || code;
          message = body.error.message || message;
        }
      } catch {
        // ignore parse errors
      }

      // Retry on 429 with backoff
      if (response.status === 429 && retries > 0) {
        const retryAfter = parseInt(response.headers.get("Retry-After") || "2", 10);
        const waitMs = Math.max(retryAfter, 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return this.request(path, options, retries - 1);
      }

      throw new ApiError(response.status, code, message);
    }

    return response;
  }

  async listProjects(): Promise<ProjectListItem[]> {
    const res = await this.request("/api/v1/projects");
    const body = await res.json();
    return body.data;
  }

  async getProject(projectId: string): Promise<Project> {
    const res = await this.request(`/api/v1/projects/${projectId}`);
    const body = await res.json();
    return body.data;
  }

  async exportFile(
    projectId: string,
    format: string,
    lang: string,
    namespace?: string
  ): Promise<string> {
    const params = new URLSearchParams({ format, lang });
    if (namespace) params.set("namespace", namespace);
    const res = await this.request(
      `/api/v1/projects/${projectId}/export?${params}`
    );
    return res.text();
  }

  async importFile(
    projectId: string,
    file: Blob,
    lang: string,
    format: string,
    namespace?: string
  ): Promise<ImportResult> {
    const formData = new FormData();
    formData.append("file", file, `translations.${format.includes("json") ? "json" : format}`);
    formData.append("lang", lang);
    formData.append("format", format);
    if (namespace) formData.append("namespace", namespace);

    const res = await this.request(`/api/v1/projects/${projectId}/import`, {
      method: "POST",
      body: formData,
    }, 3, 300_000);
    const body = await res.json();
    return body.data;
  }

  async addLanguage(projectId: string, languageCode: string): Promise<void> {
    await this.request(`/api/v1/projects/${projectId}/languages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language_code: languageCode }),
    });
  }

  async getMissingCount(projectId: string, lang: string): Promise<number> {
    const res = await this.request(
      `/api/v1/projects/${projectId}/missing/${lang}?perPage=1`
    );
    const body = await res.json();
    return body.meta.total;
  }
}
