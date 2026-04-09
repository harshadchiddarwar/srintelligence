/**
 * BaseAgent — abstract base class for all SRIntelligence ML agents.
 *
 * Execution flow:
 *   1. validateInput  — agent-specific guard
 *   2. CacheManager   — return cached result if available (lazy import)
 *   3. RateLimiter    — reject if rate-limited (lazy import)
 *   4. buildSQL       — agent-specific SQL construction
 *   5. executeSQL     — Snowflake SQL API call
 *   6. parseResults   — agent-specific result mapping
 *   7. LineageTracker — record lineage (lazy import, non-blocking)
 *   8. CacheManager   — store result (lazy import, non-blocking)
 */

import { randomUUID } from 'crypto';
import { executeSQL } from '../snowflake/sql-api';
import type {
  AgentInput,
  AgentResult,
  AgentArtifact,
  AgentIntent,
  CacheStatus,
} from '../../types/agent';

// ---------------------------------------------------------------------------
// Internal shapes used across agents
// ---------------------------------------------------------------------------

export interface ParsedData {
  data: unknown;
  sql?: string;
  narrative?: string;
  columns?: string[];
  metadata?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers for constructing well-formed AgentResult values
// ---------------------------------------------------------------------------

function makeArtifact(
  agentName: string,
  intent: AgentIntent,
  parsed: ParsedData,
  sql: string,
  cacheStatus: CacheStatus,
  lineageId: string,
): AgentArtifact {
  return {
    id: randomUUID(),
    agentName,
    intent,
    data: parsed.data,
    sql,
    narrative: parsed.narrative,
    createdAt: Date.now(),
    lineageId,
    cacheStatus,
    costEstimate: undefined,
  };
}

// ---------------------------------------------------------------------------
// Abstract BaseAgent
// ---------------------------------------------------------------------------

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly description: string;
  abstract readonly intent: AgentIntent;

  // -------------------------------------------------------------------------
  // Abstract methods — implemented by each concrete agent
  // -------------------------------------------------------------------------

  abstract validateInput(input: AgentInput): ValidationResult;

  /**
   * Construct the SQL string that will be sent to Snowflake.
   * Receives the full AgentInput so agents can read extraContext.
   */
  abstract buildSQL(input: AgentInput): string;

  /**
   * Map raw Snowflake rows into a ParsedData structure.
   * The base execute() will wrap this into an AgentResult.
   */
  abstract parseResults(
    rows: Record<string, unknown>[],
    columns: string[],
    input: AgentInput,
  ): ParsedData;

  // -------------------------------------------------------------------------
  // execute() — the main entry-point for all agents
  // -------------------------------------------------------------------------

  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    const lineageId = randomUUID();

    // ------------------------------------------------------------------
    // 1. Validate input
    // ------------------------------------------------------------------
    const validation = this.validateInput(input);
    if (!validation.valid) {
      return this.makeErrorResult(
        validation.error ?? 'Invalid input',
        'VALIDATION_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // 2. Cache lookup (lazy import — silently skip on any error)
    // ------------------------------------------------------------------
    let cacheStatus: CacheStatus = 'miss';
    const cacheKey = this.buildCacheKey(input);
    const bypassCache = (input.extraContext?.bypassCache as boolean | undefined) ?? false;

    if (!bypassCache) {
      try {
        const { CacheManager } = await import('./cache-manager');
        const cached = await CacheManager.getInstance().get(cacheKey);
        if (cached) {
          return { ...cached, durationMs: Date.now() - startTime, retryCount: 0 };
        }
      } catch {
        // CacheManager not available — continue without cache
      }
    }

    // ------------------------------------------------------------------
    // 3. Rate limiter check (lazy import — silently skip on any error)
    // ------------------------------------------------------------------
    try {
      const { RateLimiter } = await import('./rate-limiter');
      const allowed = await RateLimiter.getInstance().checkAndConsume(input.userId);
      if (!allowed) {
        return this.makeErrorResult(
          'Rate limit exceeded. Please wait before sending another request.',
          'RATE_LIMITED',
          startTime,
          lineageId,
        );
      }
    } catch {
      // RateLimiter not available — proceed without rate limiting
    }

    // ------------------------------------------------------------------
    // 4 & 5. Build SQL and execute
    // ------------------------------------------------------------------
    let sql: string;
    try {
      sql = this.buildSQL(input);
    } catch (err) {
      return this.makeErrorResult(
        `SQL construction failed: ${err instanceof Error ? err.message : String(err)}`,
        'SQL_BUILD_ERROR',
        startTime,
        lineageId,
      );
    }

    let rows: Record<string, unknown>[];
    let columns: string[];
    try {
      const sqlResult = await executeSQL(sql, input.userPreferences.userId);
      rows = sqlResult.rows;
      columns = sqlResult.columns;
    } catch (err) {
      return this.makeErrorResult(
        `SQL execution failed: ${err instanceof Error ? err.message : String(err)}`,
        'SQL_EXECUTION_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // 6. Parse results
    // ------------------------------------------------------------------
    let parsed: ParsedData;
    try {
      parsed = this.parseResults(rows, columns, input);
    } catch (err) {
      return this.makeErrorResult(
        `Result parsing failed: ${err instanceof Error ? err.message : String(err)}`,
        'PARSE_ERROR',
        startTime,
        lineageId,
      );
    }

    const artifact = makeArtifact(
      this.name,
      this.intent,
      parsed,
      sql,
      cacheStatus,
      lineageId,
    );

    const result: AgentResult = {
      success: true,
      artifact,
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };

    // ------------------------------------------------------------------
    // 7. Record lineage (lazy import — non-blocking, fire-and-forget)
    // ------------------------------------------------------------------
    this.recordLineage(input, result, lineageId).catch(() => {
      // Lineage recording failure must never surface to the caller
    });

    // ------------------------------------------------------------------
    // 8. Store in cache (lazy import — non-blocking, fire-and-forget)
    // ------------------------------------------------------------------
    if (!bypassCache) {
      this.storeInCache(cacheKey, result).catch(() => {
        // Cache write failure must never surface to the caller
      });
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Protected helpers available to subclasses
  // -------------------------------------------------------------------------

  protected makeErrorResult(
    error: string,
    errorType: string,
    startTime: number,
    lineageId: string,
  ): AgentResult {
    const artifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: null,
      narrative: `Error (${errorType}): ${error}`,
      createdAt: Date.now(),
      lineageId,
      cacheStatus: 'error',
    };
    return {
      success: false,
      artifact,
      error,
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };
  }

  protected makeSuccessData(
    data: unknown,
    narrative?: string,
    metadata?: Record<string, unknown>,
  ): ParsedData {
    return { data, narrative, metadata };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildCacheKey(input: AgentInput): string {
    return `${this.name}:${input.sessionId}:${input.userId}:${hashString(input.message)}`;
  }

  private async recordLineage(
    input: AgentInput,
    _result: AgentResult,
    lineageId: string,
  ): Promise<void> {
    const { LineageTracker } = await import('./lineage-tracker');
    await LineageTracker.getInstance().record({
      lineageId,
      sessionId: input.sessionId,
      userId: input.userId,
      intent: input.intent,
      agentName: this.name,
    });
  }

  private async storeInCache(cacheKey: string, result: AgentResult): Promise<void> {
    const { CacheManager } = await import('./cache-manager');
    await CacheManager.getInstance().set(cacheKey, result);
  }
}

// ---------------------------------------------------------------------------
// Utility: stable string hash (FNV-1a 32-bit, hex)
// ---------------------------------------------------------------------------

function hashString(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
