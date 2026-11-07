import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryAnalysisStore, type AnalysisStore, type StoredAnalysis } from "../src/analysisStore.js";
import { LayeredAnalysisStore } from "../src/layeredAnalysisStore.js";

const analysis = (id: string): StoredAnalysis => ({
  id,
  createdAt: "t",
  summary: { id },
  structuredJobDescription: {},
  bulletIds: [],
});

// A store that behaves like Redis being switched off.
class BrokenStore implements AnalysisStore {
  async save(): Promise<void> {
    throw new Error("connection refused");
  }
  async getById(): Promise<StoredAnalysis | undefined> {
    throw new Error("connection refused");
  }
  async getByJobDescriptionHash(): Promise<StoredAnalysis | undefined> {
    throw new Error("connection refused");
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LayeredAnalysisStore", () => {
  it("keeps working from memory when the main store is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new LayeredAnalysisStore(new BrokenStore(), new MemoryAnalysisStore());

    await expect(store.save("h1", analysis("a"))).resolves.toBeUndefined();
    expect((await store.getById("a"))?.id).toBe("a");
    expect((await store.getByJobDescriptionHash("h1"))?.id).toBe("a");
  });

  it("reports the outage once, not on every call", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new LayeredAnalysisStore(new BrokenStore(), new MemoryAnalysisStore());

    await store.save("h1", analysis("a"));
    await store.getById("a");
    await store.getByJobDescriptionHash("h1");

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/Redis unavailable/);
  });

  it("writes to both stores and prefers the main one when reading", async () => {
    const primary = new MemoryAnalysisStore();
    const fallback = new MemoryAnalysisStore();
    const store = new LayeredAnalysisStore(primary, fallback);

    await store.save("h1", analysis("a"));
    expect(await primary.getById("a")).toBeDefined();
    expect(await fallback.getById("a")).toBeDefined();

    await primary.save("h2", analysis("only-in-primary"));
    expect((await store.getById("only-in-primary"))?.id).toBe("only-in-primary");
  });

  it("falls back to memory when the main store simply has no entry", async () => {
    const fallback = new MemoryAnalysisStore();
    await fallback.save("h1", analysis("a"));
    const store = new LayeredAnalysisStore(new MemoryAnalysisStore(), fallback);

    expect((await store.getById("a"))?.id).toBe("a");
  });
});