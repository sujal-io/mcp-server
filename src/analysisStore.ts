import { createHash, randomUUID } from "node:crypto";

export interface StoredAnalysis {
  id: string;
  createdAt: string;
  // The result Claude saw, kept so a repeat question can be answered instantly.
  summary: Record<string, unknown>;
  // Needed by the rewrite endpoint, but too big and too easy to garble to pass through Claude.
  structuredJobDescription: Record<string, unknown>;
  bulletIds: string[];
}

// A contract: anything that can save and find analyses can be plugged in.
// Today it is memory. In the Redis phase it will be Redis.
export interface AnalysisStore {
  save(jobDescriptionHash: string, analysis: StoredAnalysis): Promise<void>;
  getById(id: string): Promise<StoredAnalysis | undefined>;
  getByJobDescriptionHash(hash: string): Promise<StoredAnalysis | undefined>;
}

// The same job description with different spacing should count as the same one.
export function hashJobDescription(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

export function newAnalysisId(): string {
  return `an_${randomUUID().slice(0, 8)}`;
}

interface Entry {
  analysis: StoredAnalysis;
  hash: string;
  expiresAt: number;
}

export class MemoryAnalysisStore implements AnalysisStore {
  private readonly entries = new Map<string, Entry>(); // analysis id -> entry
  private readonly idByHash = new Map<string, string>(); // job description hash -> analysis id
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 50;
    this.now = options.now ?? Date.now;
  }

  async save(jobDescriptionHash: string, analysis: StoredAnalysis): Promise<void> {
    this.entries.set(analysis.id, {
      analysis,
      hash: jobDescriptionHash,
      expiresAt: this.now() + this.ttlMs,
    });
    this.idByHash.set(jobDescriptionHash, analysis.id);

    // Keep memory bounded. A Map remembers insertion order, so the first key is the oldest.
    while (this.entries.size > this.maxEntries) {
      const oldestId = this.entries.keys().next().value as string;
      this.remove(oldestId);
    }
  }

  async getById(id: string): Promise<StoredAnalysis | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.remove(id);
      return undefined;
    }
    return entry.analysis;
  }

  async getByJobDescriptionHash(hash: string): Promise<StoredAnalysis | undefined> {
    const id = this.idByHash.get(hash);
    return id ? this.getById(id) : undefined;
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    if (entry && this.idByHash.get(entry.hash) === id) {
      this.idByHash.delete(entry.hash);
    }
  }
}
