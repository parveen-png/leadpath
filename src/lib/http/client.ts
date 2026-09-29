export class HttpRequestError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
    this.body = body;
  }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type HttpResult<T> = {
  status: number;
  data: T;
  rawText: string;
};

type RequestOptions = {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retryGet?: boolean;
  fetchImpl?: typeof fetch;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function httpRequest<T>(url: string, options: RequestOptions = {}): Promise<HttpResult<T>> {
  const method = options.method ?? "GET";
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const attempts = method === "GET" && options.retryGet !== false ? 3 : 1;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      const rawText = await response.text();
      let data: unknown = null;
      if (rawText) {
        try {
          data = JSON.parse(rawText) as unknown;
        } catch {
          data = { message: rawText.slice(0, 500) };
        }
      }
      if (response.status === 429 || response.status >= 500) {
        if (method === "GET" && attempt < attempts) {
          await sleep(250 * attempt * attempt);
          continue;
        }
      }
      if (!response.ok && response.status !== 204) {
        throw new HttpRequestError(response.status, data, `Request failed with HTTP ${response.status}`);
      }
      return { status: response.status, data: data as T, rawText };
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof HttpRequestError) || error.status === 429 || error.status >= 500;
      if (method === "GET" && retryable && attempt < attempts) {
        await sleep(250 * attempt * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Request failed");
}
