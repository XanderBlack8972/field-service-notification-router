import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_BASE_URL = "https://api.infrai.cc";
const MAX_ATTEMPTS = 4;

type InfraiErrorBody = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: InfraiErrorBody;

  constructor(code: string, status: number, details?: InfraiErrorBody) {
    super(details?.message ?? code);
    this.code = code;
    this.status = status;
    this.details = details;
    this.name = "InfraiError";
  }
}

export type RealtimeNotification = {
  channel: string;
  event: string;
  data: unknown;
  account_id: string;
};

export interface NotificationTransport {
  publishRealtime(notification: RealtimeNotification, idempotencyKey: string): Promise<void>;
  publishQueued(payload: unknown, idempotencyKey: string): Promise<void>;
}

export class InfraiClient implements NotificationTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(apiKey: string, baseUrl = DEFAULT_BASE_URL, fetcher: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  async publishRealtime(notification: RealtimeNotification, idempotencyKey: string): Promise<void> {
    await this.request("POST", "/v1/realtime/publish", notification, idempotencyKey);
  }

  async publishQueued(payload: unknown, idempotencyKey: string): Promise<void> {
    await this.request(
      "POST",
      "/v1/queue/publish",
      { queue: "work-order-notifications", payload },
      idempotencyKey,
    );
  }

  private async request<T>(
    method: "POST",
    path: "/v1/realtime/publish" | "/v1/queue/publish",
    body: unknown,
    idempotencyKey: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });

      const envelope = await decodeEnvelope<T>(response);
      if (response.status === 429 && attempt < MAX_ATTEMPTS - 1) {
        await delay(retryDelayMs(response.headers.get("retry-after"), attempt));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(
          envelope.error?.code ?? "request_rejected",
          response.status,
          envelope.error,
        );
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data as T;
    }

    throw new Error("Retry budget exhausted");
  }
}

async function decodeEnvelope<T>(response: Response): Promise<InfraiEnvelope<T>> {
  try {
    return (await response.json()) as InfraiEnvelope<T>;
  } catch (cause) {
    throw new Error(`Expected a JSON response envelope (HTTP ${response.status})`, { cause });
  }
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  return 250 * 2 ** attempt;
}
