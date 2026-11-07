import { describe, expect, it } from "vitest";
import {
  MemoryAnalysisStore,
  hashJobDescription,
  newAnalysisId,
  type StoredAnalysis,
} from "../src/analysisStore.js";

const analysis = (id: string): StoredAnalysis => ({
  id,
  createdAt: "2026-11-01T00:00:00.000Z",
  summary: { id },
  structuredJobDescription: {},
  bulletIds: [],
});

describe("hashJobDescription", () => {
  it("treats different spacing as the same job description", () => {
    expect(hashJobDescription("Node.js  and\n Express")).toBe(hashJobDescription("  Node.js and Express "));
  });

  it("gives different hashes for different text", () => {
    expect(hashJobDescription("Node.js")).not.toBe(hashJobDescription("Python"));
  });

  it("produces a 64 character SHA-256 hex string", () => {
    expect(hashJobDescription("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("newAnalysisId", () => {
  it("has the expected shape and is unique", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newAnalysisId()));
    expect(ids.size).toBe(200);
    expect([...ids][0]).toMatch(/^an_[0-9a-f]{8}$/);
  });
});

describe("MemoryAnalysisStore", () => {
  it("finds an analysis by id and by job description hash", async () => {
    const store = new MemoryAnalysisStore();
    await store.save("hash-1", analysis("a"));

    expect((await store.getById("a"))?.id).toBe("a");
    expect((await store.getByJobDescriptionHash("hash-1"))?.id).toBe("a");
    expect(await store.getById("missing")).toBeUndefined();
  });

  it("expires entries after the time to live", async () => {
    let now = 1_000;
    const store = new MemoryAnalysisStore({ ttlMs: 100, now: () => now });
    await store.save("hash-1", analysis("a"));

    now += 99;
    expect(await store.getById("a")).toBeDefined();

    now += 2; // 101 ms after saving
    expect(await store.getById("a")).toBeUndefined();
    expect(await store.getByJobDescriptionHash("hash-1")).toBeUndefined();
  });

  it("drops the oldest entry, and its hash pointer, when the size limit is exceeded", async () => {
    const store = new MemoryAnalysisStore({ maxEntries: 2 });
    await store.save("h1", analysis("a"));
    await store.save("h2", analysis("b"));
    await store.save("h3", analysis("c"));

    expect(await store.getById("a")).toBeUndefined();
    expect(await store.getByJobDescriptionHash("h1")).toBeUndefined();
    expect(await store.getById("b")).toBeDefined();
    expect(await store.getById("c")).toBeDefined();
  });

  it("lets a newer analysis of the same job description take over the hash", async () => {
    const store = new MemoryAnalysisStore({ maxEntries: 2 });
    await store.save("h1", analysis("old"));
    await store.save("h1", analysis("new"));
    expect((await store.getByJobDescriptionHash("h1"))?.id).toBe("new");

    await store.save("h2", analysis("other")); // pushes the oldest entry out
    expect((await store.getByJobDescriptionHash("h1"))?.id).toBe("new");
  });
});