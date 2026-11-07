import { describe, expect, it, vi } from "vitest";
import { StrategistClient } from "../src/strategistClient.js";
import { TEST_CONFIG, TEST_KEY, jsonResponse } from "./helpers.js";

function clientWith(fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  return new StrategistClient(TEST_CONFIG, fetchImpl as unknown as typeof fetch);
}

describe("StrategistClient.postJson", () => {
  it("sends a POST with the service key and a JSON body to the joined URL", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    const result = await clientWith(fetchMock).postJson("/api/test", { hello: "world" });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://strategist.test/api/test"); // no double slash
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ hello: "world" }));
    expect(init.headers).toMatchObject({ "x-service-key": TEST_KEY, "Content-Type": "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // status, response body, headers, expected error kind, expected message
  it.each([
    [400, { message: "Invalid request body." }, {}, "bad_request", /Invalid request body/],
    [401, { message: "Unauthorized" }, {}, "auth", /service key/],
    [404, { message: "Resume not found." }, {}, "not_found", /No resume is stored/],
    [404, { message: "Resume bullet not found." }, {}, "not_found", /bullet is no longer/],
    [404, { message: "nope" }, {}, "not_found", /endpoint was not found/],
    [429, { error: "limit" }, { "Retry-After": "1800" }, "rate_limited", /30 minute/],
    [429, { error: "limit" }, {}, "rate_limited", /Try again later/],
    [502, { message: "AI down" }, {}, "upstream", /temporarily unavailable/],
    [418, { message: "teapot" }, {}, "bad_response", /status 418/],
  ] as const)("maps HTTP %i to the %s error", async (status, body, headers, kind, message) => {
    const client = clientWith(async () => jsonResponse(status, body, { ...headers }));
    await expect(client.postJson("/x", {})).rejects.toMatchObject({ kind, message: expect.stringMatching(message) });
  });

  it("copes with an error response that is not JSON", async () => {
    const client = clientWith(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(client.postJson("/x", {})).rejects.toMatchObject({ kind: "upstream" });
  });

  it("reports a timeout in plain words", async () => {
    const client = clientWith(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    await expect(client.postJson("/x", {})).rejects.toMatchObject({
      kind: "timeout",
      message: expect.stringMatching(/within 55 seconds/),
    });
  });

  it("reports an unreachable server", async () => {
    const client = clientWith(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(client.postJson("/x", {})).rejects.toMatchObject({ kind: "network" });
  });

  it("rejects a success response that is not JSON", async () => {
    const client = clientWith(async () => new Response("hello", { status: 200 }));
    await expect(client.postJson("/x", {})).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("never puts the service key in an error message", async () => {
    const statuses = [400, 401, 404, 429, 500];
    for (const status of statuses) {
      const client = clientWith(async () => jsonResponse(status, { message: "x" }));
      const error = await client.postJson("/x", {}).catch((e: Error) => e);
      expect((error as Error).message).not.toContain(TEST_KEY);
    }
  });
});