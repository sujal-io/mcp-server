import { MemoryAnalysisStore, type AnalysisStore } from "./analysisStore.js";
import type { Config } from "./config.js";
import { LayeredAnalysisStore } from "./layeredAnalysisStore.js";
import { RedisAnalysisStore, createRedisClient } from "./redisAnalysisStore.js";

export interface Cache {
  store: AnalysisStore;
  close: () => void;
}

// Redis is optional. With no REDIS_URL the server works exactly as before.
export function createCache(config: Config): Cache {
  const memory = new MemoryAnalysisStore();

  if (!config.REDIS_URL) {
    console.error("Cache: memory only (REDIS_URL is not set)");
    return { store: memory, close: () => {} };
  }

  const redis = createRedisClient(config.REDIS_URL);
  console.error("Cache: Redis, with memory as a backup");

  return {
    store: new LayeredAnalysisStore(new RedisAnalysisStore(redis), memory),
    close: () => redis.disconnect(),
  };
}