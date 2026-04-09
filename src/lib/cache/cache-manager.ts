/**
 * CacheManager — two-tier result cache.
 * Tier 1: in-process LRU (fast, ephemeral).
 * Tier 2: Snowflake QUERY_CACHE table (durable, cross-instance).
 */

import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';
import type { AgentIntent, AgentResult, AgentContext } from '../../types/agent';
import { executeSQL } from '../snowflake/sql-api';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

interface CachedResult {
  result: AgentResult;
  cachedAt: number;
}

// TTL in minutes per intent
const INTENT_TTL_MINUTES: Partial<Record<AgentIntent, number>> = {
  ANALYST: 15,
  FORECAST_PROPHET: 60,
  FORECAST_SARIMA: 60,
  FORECAST_HW: 60,
  FORECAST_XGB: 60,
  FORECAST_AUTO: 60,
  FORECAST_COMPARE: 120,
  MTREE: 30,
  CLUSTER: 60,
};

// ---------------------------------------------------------------------------
// CacheManager (singleton)
// ---------------------------------------------------------------------------

export class CacheManager {
  private static instance: CacheManager;

  private memoryCache: LRUCache<string, CachedResult>;

  private constructor() {
    this.memoryCache = new LRUCache<string, CachedResult>({
      max: 200,
      ttl: 15 * 60 * 1_000, // default 15-minute TTL
    });
  }

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  // ---------------------------------------------------------------------------
  // Key computation
  // ---------------------------------------------------------------------------

  computeCacheKey(
    intent: AgentIntent,
    sourceSQL: string,
    parameters: Record<string, unknown>,
    semanticViewId: string,
    userRole: string,
  ): string {
    const normalizedSQL = sourceSQL.trim().toLowerCase().replace(/\s+/g, ' ');
    const paramJSON = JSON.stringify(
      Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))),
    );
    const raw = `${intent}:${normalizedSQL}:${paramJSON}:${semanticViewId}:${userRole}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Get
  // ---------------------------------------------------------------------------

  async get(
    intent: AgentIntent,
    sourceSQL: string,
    parameters: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentResult | null> {
    const key = this.computeCacheKey(
      intent,
      sourceSQL,
      parameters,
      context.semanticView.id,
      context.userRole,
    );

    // Tier 1: memory
    const memHit = this.memoryCache.get(key);
    if (memHit) {
      return { ...memHit.result, artifact: memHit.result.artifact ? { ...memHit.result.artifact, cacheStatus: 'hit' } : undefined };
    }

    // Tier 2: Snowflake
    try {
      const sql = `
        SELECT result_json, cached_at
        FROM CORTEX_TESTING.PUBLIC.QUERY_CACHE
        WHERE cache_key = '${key}'
          AND expires_at > CURRENT_TIMESTAMP()
        LIMIT 1
      `;
      const result = await executeSQL(sql, context.userRole);
      if (result.rowCount > 0 && result.rows[0]) {
        const row = result.rows[0] as Record<string, unknown>;
        const parsed = JSON.parse(row['RESULT_JSON'] as string) as AgentResult;
        // Warm memory tier
        this.memoryCache.set(key, { result: parsed, cachedAt: Date.now() });
        return { ...parsed, artifact: parsed.artifact ? { ...parsed.artifact, cacheStatus: 'hit' } : undefined };
      }
    } catch {
      // Snowflake cache miss or error — proceed as cache miss
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Set
  // ---------------------------------------------------------------------------

  async set(
    intent: AgentIntent,
    sourceSQL: string,
    parameters: Record<string, unknown>,
    context: AgentContext,
    result: AgentResult,
  ): Promise<void> {
    // Don't cache errors or empty results
    if (!result.success || !result.artifact) return;
    const data = result.artifact.data;
    if (Array.isArray(data) && data.length === 0) return;

    const key = this.computeCacheKey(
      intent,
      sourceSQL,
      parameters,
      context.semanticView.id,
      context.userRole,
    );

    const ttlMinutes = INTENT_TTL_MINUTES[intent] ?? 15;
    const ttlMs = ttlMinutes * 60 * 1_000;

    // Store in memory
    this.memoryCache.set(key, { result, cachedAt: Date.now() }, { ttl: ttlMs });

    // Fire-and-forget Snowflake store
    this.storeInSnowflake(key, intent, result, ttlMinutes, context.userRole).catch(() => {
      // Non-blocking — ignore errors
    });
  }

  private async storeInSnowflake(
    key: string,
    intent: AgentIntent,
    result: AgentResult,
    ttlMinutes: number,
    userRole: string,
  ): Promise<void> {
    const resultJson = JSON.stringify(result).replace(/'/g, "\\'");
    const sql = `
      MERGE INTO CORTEX_TESTING.PUBLIC.QUERY_CACHE AS tgt
      USING (SELECT '${key}' AS cache_key) AS src
      ON tgt.cache_key = src.cache_key
      WHEN MATCHED THEN UPDATE SET
        result_json = '${resultJson}',
        cached_at = CURRENT_TIMESTAMP(),
        expires_at = DATEADD('minute', ${ttlMinutes}, CURRENT_TIMESTAMP()),
        intent = '${intent}'
      WHEN NOT MATCHED THEN INSERT (cache_key, intent, result_json, cached_at, expires_at)
        VALUES ('${key}', '${intent}', '${resultJson}', CURRENT_TIMESTAMP(), DATEADD('minute', ${ttlMinutes}, CURRENT_TIMESTAMP()))
    `;
    await executeSQL(sql, userRole);
  }

  // ---------------------------------------------------------------------------
  // Invalidate
  // ---------------------------------------------------------------------------

  async invalidate(params: {
    key?: string;
    intent?: AgentIntent;
    semanticViewId?: string;
    all?: boolean;
  }): Promise<number> {
    let deleted = 0;

    if (params.all) {
      deleted = this.memoryCache.size;
      this.memoryCache.clear();
      try {
        await executeSQL('DELETE FROM CORTEX_TESTING.PUBLIC.QUERY_CACHE');
      } catch { /* ignore */ }
      return deleted;
    }

    if (params.key) {
      const had = this.memoryCache.has(params.key);
      this.memoryCache.delete(params.key);
      if (had) deleted += 1;
      try {
        await executeSQL(`DELETE FROM CORTEX_TESTING.PUBLIC.QUERY_CACHE WHERE cache_key = '${params.key}'`);
      } catch { /* ignore */ }
    }

    if (params.intent) {
      // Evict all memory entries (we can't introspect keys by intent without scanning)
      // This is a best-effort in-memory purge
      this.memoryCache.clear();
      try {
        await executeSQL(
          `DELETE FROM CORTEX_TESTING.PUBLIC.QUERY_CACHE WHERE intent = '${params.intent}'`,
        );
      } catch { /* ignore */ }
      deleted += 1;
    }

    return deleted;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  async getStats(): Promise<{
    memorySize: number;
    memoryMaxSize: number;
    snowflakeEntries: number;
  }> {
    let snowflakeEntries = 0;
    try {
      const result = await executeSQL(
        'SELECT COUNT(*) AS CNT FROM CORTEX_TESTING.PUBLIC.QUERY_CACHE WHERE expires_at > CURRENT_TIMESTAMP()',
      );
      if (result.rowCount > 0) {
        snowflakeEntries = Number((result.rows[0] as Record<string, unknown>)['CNT'] ?? 0);
      }
    } catch { /* ignore */ }

    return {
      memorySize: this.memoryCache.size,
      memoryMaxSize: 200,
      snowflakeEntries,
    };
  }
}

export const cacheManager = CacheManager.getInstance();
