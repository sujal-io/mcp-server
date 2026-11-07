import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import type { StoredAnalysis } from "../src/analysisStore.js";
import { RedisAnalysisStore, createRedisClient } from "../src/redisAnalysisStore.js";

const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// These tests need a real Redis (for example: npm run redis:up). When none is
// reachable they are skipped, so the rest of the suite still passes anywhere.
async function redisIsReachable(): Promise<boolean> {
  const probe = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 500,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  probe.on("error", () => {});
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const available = await redisIsReachable();

describe.skipIf(!available)("RedisAnalysisStore (needs a running Redis)", () => {
  const clients: Redis[] = [];
  const keysToClean: string[] = [];

  const connect = () => {
    const redis = createRedisClient(url);
    clients.push(redis);
    return redis;
  };

  // Random ids so these tests can never touch real cached data.
  const makeAnalysis = (): { hash: string; analysis: StoredAnalysis } => {
    const id = `an_test_${randomUUID().slice(0, 8)}`;
    const hash = `test_${randomUUID()}`;
    keysToClean.push(`asmcp:analysis:${id}`, `asmcp:jdhash:${hash}`);
    return {
      hash,
      analysis: { id, createdAt: "t", summary: { role: "Dev" }, structuredJobDescription: { a: 1 }, bulletIds: ["b1"] },
    };
  };

  afterAll(async () => {
    const cleaner = connect();
    if (keysToClean.length > 0) await cleaner.del(...keysToClean);
    clients.forEach((client) => client.disconnect());
  });

  it("saves an analysis and finds it by id and by job description hash", async () => {
    const store = new RedisAnalysisStore(connect());
    const { hash, analysis } = makeAnalysis();
    await store.save(hash, analysis);

    expect(await store.getById(analysis.id)).toEqual(analysis);
    expect((await store.getByJobDescriptionHash(hash))?.id).toBe(analysis.id);
    expect(await store.getById("an_does_not_exist")).toBeUndefined();
  });

  it("gives both keys a 24 hour lifetime", async () => {
    const redis = connect();
    const store = new RedisAnalysisStore(redis);
    const { hash, analysis } = makeAnalysis();
    await store.save(hash, analysis);

    for (const key of [`asmcp:analysis:${analysis.id}`, `asmcp:jdhash:${hash}`]) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(86_000);
      expect(ttl).toBeLessThanOrEqual(86_400);
    }
  });

  it("is still there for a second connection, as after a server restart", async () => {
    const { hash, analysis } = makeAnalysis();
    await new RedisAnalysisStore(connect()).save(hash, analysis);

    const afterRestart = new RedisAnalysisStore(connect());
    expect((await afterRestart.getByJobDescriptionHash(hash))?.id).toBe(analysis.id);
  });

  it("treats unreadable data as a miss instead of crashing", async () => {
    const redis = connect();
    const { analysis } = makeAnalysis();
    await redis.set(`asmcp:analysis:${analysis.id}`, "this is not json", "EX", 60);

    expect(await new RedisAnalysisStore(redis).getById(analysis.id)).toBeUndefined();
  });
});