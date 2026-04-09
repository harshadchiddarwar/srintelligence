/**
 * CacheManager — in-memory LRU-style result cache for AgentResult values.
 *
 * Features:
 *   - TTL-based expiry (default 5 minutes)
 *   - Maximum entry cap to bound memory use
 *   - Invalidation by key, intent prefix, or semantic view ID prefix
 *   - getStats() for observability
 *   - Singleton via getInstance()
 *
 * All async methods are kept async to allow a future drop-in replacement
 * with a distributed cache (Redis, Memcached, etc.) without API changes.
 */

import type { AgentResult } from '../../types/agent';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 5 * 60 * 1_000; // 5 minutes
const MAX_ENTRIES = 500;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: AgentResult;
  expiresAt: number;
  createdAt: number;
  /** Encoded tags for targeted invalidation */
  tags: string[];
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

// ---------------------------------------------------------------------------
// CacheManager
// ---------------------------------------------------------------------------

export class CacheManager {
  private static instance: CacheManager;

  private readonly store = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  private hits = 0;
  private misses = 0;
  private evictions = 0;

  private constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  // -------------------------------------------------------------------------
  // Core get / set
  // -------------------------------------------------------------------------

  async get(key: string): Promise<AgentResult | null> {
    this.evictExpired();

    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.result;
  }

  async set(key: string, result: AgentResult, tags: string[] = []): Promise<void> {
    // Evict oldest entries if at capacity
    if (this.store.size >= MAX_ENTRIES) {
      this.evictOldest();
    }

    this.store.set(key, {
      result,
      expiresAt: Date.now() + this.ttlMs,
      createdAt: Date.now(),
      tags,
    });
  }

  // -------------------------------------------------------------------------
  // Invalidation
  // -------------------------------------------------------------------------

  /** Remove a single entry by exact key. */
  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Remove all entries whose key starts with the given intent prefix. */
  async invalidateByIntent(intent: string): Promise<void> {
    const prefix = intent.toLowerCase();
    for (const key of [...this.store.keys()]) {
      if (key.toLowerCase().startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** Remove all entries whose tags contain the given semantic view ID. */
  async invalidateByViewId(viewId: string): Promise<void> {
    for (const [key, entry] of this.store) {
      if (entry.tags.includes(viewId)) {
        this.store.delete(key);
      }
    }
  }

  /** Flush the entire cache. */
  async invalidateAll(): Promise<void> {
    this.store.clear();
  }

  // -------------------------------------------------------------------------
  // Observability
  // -------------------------------------------------------------------------

  getStats(): CacheStats {
    this.evictExpired();
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt < now) {
        this.store.delete(key);
        this.evictions++;
      }
    }
  }

  private evictOldest(): void {
    // Evict the 10% oldest entries by createdAt
    const sorted = [...this.store.entries()].sort(
      ([, a], [, b]) => a.createdAt - b.createdAt,
    );
    const toEvict = Math.max(1, Math.floor(MAX_ENTRIES * 0.1));
    for (let i = 0; i < toEvict && i < sorted.length; i++) {
      this.store.delete(sorted[i][0]);
      this.evictions++;
    }
  }
}

// Pre-constructed singleton
export const cacheManager = CacheManager.getInstance();
