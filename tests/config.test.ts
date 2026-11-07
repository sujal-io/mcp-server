import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const VALID = {
  STRATEGIST_BASE_URL: "https://example.onrender.com",
  STRATEGIST_SERVICE_KEY: "k".repeat(32),
};

describe("loadConfig", () => {
  it("accepts valid settings and applies defaults", () => {
    const config = loadConfig(VALID);
    expect(config.STRATEGIST_TIMEOUT_MS).toBe(55_000);
    expect(config.TRACKER_DB_PATH).toBeUndefined();
    expect(config.REDIS_URL).toBeUndefined();
  });

  it("removes trailing slashes from the base URL", () => {
    expect(loadConfig({ ...VALID, STRATEGIST_BASE_URL: "https://example.com///" }).STRATEGIST_BASE_URL).toBe(
      "https://example.com"
    );
  });

  it("reads numbers that arrive as text", () => {
    expect(loadConfig({ ...VALID, STRATEGIST_TIMEOUT_MS: "1500" }).STRATEGIST_TIMEOUT_MS).toBe(1500);
  });

  it("names the missing setting in its error", () => {
    expect(() => loadConfig({ STRATEGIST_BASE_URL: VALID.STRATEGIST_BASE_URL })).toThrow(/STRATEGIST_SERVICE_KEY/);
  });

  it("rejects a service key that is too short", () => {
    expect(() => loadConfig({ ...VALID, STRATEGIST_SERVICE_KEY: "short" })).toThrow(/at least 16/);
  });

  it("rejects a base URL that is not a URL", () => {
    expect(() => loadConfig({ ...VALID, STRATEGIST_BASE_URL: "not a url" })).toThrow(/STRATEGIST_BASE_URL/);
  });

  it("treats an empty setting as not set", () => {
    expect(loadConfig({ ...VALID, REDIS_URL: "" }).REDIS_URL).toBeUndefined();
  });

  it("keeps a valid Redis URL", () => {
    expect(loadConfig({ ...VALID, REDIS_URL: "redis://127.0.0.1:6379" }).REDIS_URL).toBe("redis://127.0.0.1:6379");
  });
});