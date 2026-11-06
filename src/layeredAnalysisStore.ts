import type { AnalysisStore, StoredAnalysis } from "./analysisStore.js";

// Wraps a main store (Redis) and a backup (memory). Writes go to both. Reads try
// the main store first and fall back to the backup, so a Redis outage never
// breaks a tool call. It only means results are not remembered across restarts.
export class LayeredAnalysisStore implements AnalysisStore {
  private readonly primary: AnalysisStore;
  private readonly fallback: AnalysisStore;
  private lastReport = 0;

  constructor(primary: AnalysisStore, fallback: AnalysisStore) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private report(err: unknown): void {
    if (Date.now() - this.lastReport > 60_000) {
      this.lastReport = Date.now();
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Cache: Redis unavailable, using memory only (${message})`);
    }
  }

  async save(jobDescriptionHash: string, analysis: StoredAnalysis): Promise<void> {
    await this.fallback.save(jobDescriptionHash, analysis);
    try {
      await this.primary.save(jobDescriptionHash, analysis);
    } catch (err) {
      this.report(err);
    }
  }

  async getById(id: string): Promise<StoredAnalysis | undefined> {
    try {
      const found = await this.primary.getById(id);
      if (found) return found;
    } catch (err) {
      this.report(err);
    }
    return this.fallback.getById(id);
  }

  async getByJobDescriptionHash(hash: string): Promise<StoredAnalysis | undefined> {
    try {
      const found = await this.primary.getByJobDescriptionHash(hash);
      if (found) return found;
    } catch (err) {
      this.report(err);
    }
    return this.fallback.getByJobDescriptionHash(hash);
  }
}