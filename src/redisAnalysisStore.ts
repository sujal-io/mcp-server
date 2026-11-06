import { Redis } from "ioredis";
import type { AnalysisStore, StoredAnalysis } from "./analysisStore.js";

const PREFIX = "asmcp:"; // every key we create starts with this, so we never collide with other data

// Connect in a way that fails fast. By default a Redis client keeps retrying and
// makes every command wait, which would freeze a tool call if Redis is off.
export function createRedisClient(url: string): Redis {
  const redis = new Redis(url, {
    connectTimeout: 2000,
    commandTimeout: 1500,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
  });

  // Without an error listener, a connection problem would be thrown as an uncaught exception.
  let lastLogged = 0;
  redis.on("error", (err: Error) => {
    if (Date.now() - lastLogged > 60_000) {
      lastLogged = Date.now();
      console.error(`Redis problem (will keep trying quietly): ${err.message}`);
    }
  });

  return redis;
}

export class RedisAnalysisStore implements AnalysisStore {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;

  constructor(redis: Redis, ttlSeconds = 24 * 60 * 60) {
    this.redis = redis;
    this.ttlSeconds = ttlSeconds;
  }

  private idKey(id: string): string {
    return `${PREFIX}analysis:${id}`;
  }

  private hashKey(hash: string): string {
    return `${PREFIX}jdhash:${hash}`;
  }

  async save(jobDescriptionHash: string, analysis: StoredAnalysis): Promise<void> {
    // MULTI/EXEC sends both writes as one unit: both are saved or neither is.
    // EX gives each key a lifetime, and Redis deletes it by itself when it runs out.
    const results = await this.redis
      .multi()
      .set(this.idKey(analysis.id), JSON.stringify(analysis), "EX", this.ttlSeconds)
      .set(this.hashKey(jobDescriptionHash), analysis.id, "EX", this.ttlSeconds)
      .exec();

    const failed = results?.find(([err]) => err);
    if (!results || failed) {
      throw failed?.[0] ?? new Error("Redis transaction was aborted");
    }
  }

  async getById(id: string): Promise<StoredAnalysis | undefined> {
    const raw = await this.redis.get(this.idKey(id));
    if (!raw) return undefined;

    try {
      return JSON.parse(raw) as StoredAnalysis;
    } catch {
      return undefined; // unreadable data is treated as a miss, not a crash
    }
  }

  async getByJobDescriptionHash(hash: string): Promise<StoredAnalysis | undefined> {
    const id = await this.redis.get(this.hashKey(hash));
    return id ? this.getById(id) : undefined;
  }
}