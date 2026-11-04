import type { Config } from "./config.js";

export type StrategistErrorKind =
  | "auth"
  | "not_found"
  | "rate_limited"
  | "bad_request"
  | "upstream"
  | "timeout"
  | "network"
  | "bad_response";

export class StrategistError extends Error {
  readonly kind: StrategistErrorKind;

  constructor(kind: StrategistErrorKind, message: string) {
    super(message);
    this.name = "StrategistError";
    this.kind = kind;
  }
}

// Turn a failed HTTP response into an error with a message Claude can explain.
async function errorFromResponse(res: Response): Promise<StrategistError> {
  let detail = "";
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const { message, error } = body as { message?: unknown; error?: unknown };
      if (typeof message === "string") detail = message;
      else if (typeof error === "string") detail = error;
    }
  } catch {
    // The body was not JSON. The status code alone has to be enough.
  }

  if (res.status === 400) {
    return new StrategistError(
      "bad_request",
      `The Application Strategist rejected the request${detail ? `: ${detail}` : "."}`
    );
  }

  if (res.status === 401) {
    return new StrategistError(
      "auth",
      "The Application Strategist refused the service key. Check that STRATEGIST_SERVICE_KEY in the server settings matches MCP_SERVICE_KEY on Render."
    );
  }

  if (res.status === 404) {
    if (/resume not found/i.test(detail)) {
      return new StrategistError(
        "not_found",
        "No resume is stored for the owner account. Upload your resume on the Application Strategist website first, or check MCP_SERVICE_USER_ID on Render."
      );
    }
    return new StrategistError(
      "not_found",
      "The Application Strategist endpoint was not found. Check STRATEGIST_BASE_URL."
    );
  }

  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(seconds) && seconds > 0
      ? ` Try again in about ${Math.ceil(seconds / 60)} minute(s).`
      : " Try again later.";
    return new StrategistError(
      "rate_limited",
      `Hourly limit reached on the Application Strategist.${wait}`
    );
  }

  if (res.status >= 500) {
    return new StrategistError(
      "upstream",
      "The Application Strategist, or the AI service behind it, is temporarily unavailable. Try again shortly."
    );
  }

  return new StrategistError(
    "bad_response",
    `Unexpected response from the Application Strategist (status ${res.status}).`
  );
}

export class StrategistClient {
  private readonly config: Config;
  private readonly fetchImpl: typeof fetch;

  constructor(config: Config, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async postJson(path: string, body: unknown): Promise<unknown> {
    const url = `${this.config.STRATEGIST_BASE_URL}${path}`;
    let res: Response;

    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-key": this.config.STRATEGIST_SERVICE_KEY,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.STRATEGIST_TIMEOUT_MS),
      });
    } catch (err) {
      const name =
        typeof err === "object" && err !== null && "name" in err
          ? String((err as { name: unknown }).name)
          : "";

      if (name === "TimeoutError" || name === "AbortError") {
        throw new StrategistError(
          "timeout",
          `No answer from the Application Strategist within ${Math.round(
            this.config.STRATEGIST_TIMEOUT_MS / 1000
          )} seconds. Free hosting goes to sleep when idle, so the server may still be waking up. Try again in a minute.`
        );
      }

      throw new StrategistError(
        "network",
        "Could not reach the Application Strategist. Check STRATEGIST_BASE_URL and your internet connection."
      );
    }

    if (!res.ok) {
      throw await errorFromResponse(res);
    }

    try {
      return await res.json();
    } catch {
      throw new StrategistError(
        "bad_response",
        "The Application Strategist returned something that was not valid JSON."
      );
    }
  }

  // Free Render servers sleep when idle. A quick request at startup wakes it
  // up in the background, so the first real tool call is not slow.
  warmUp(): void {
    this.fetchImpl(this.config.STRATEGIST_BASE_URL, {
      signal: AbortSignal.timeout(60_000),
    })
      .then(() => console.error("Application Strategist warm-up ping done"))
      .catch(() =>
        console.error("Application Strategist warm-up ping failed (server may be asleep or offline)")
      );
  }
}