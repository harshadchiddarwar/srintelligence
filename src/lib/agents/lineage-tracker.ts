/**
 * LineageTracker — records execution lineage for agent invocations.
 *
 * Each agent call produces a lineage record linking the user message →
 * routing decision → agent execution → response. Records are kept in
 * memory for the lifetime of the process (suitable for development and
 * single-instance deployments). A future implementation can persist to
 * Snowflake or another store without changing the agent-facing API.
 *
 * The record() method is the primary API consumed by agents. All other
 * methods are for diagnostic and admin use.
 */

import type { AgentIntent } from '../../types/agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LineageRecordInput {
  lineageId: string;
  sessionId: string;
  userId: string;
  intent: AgentIntent;
  agentName: string;
  /** Optional metadata to attach to the record */
  metadata?: Record<string, unknown>;
}

export interface StoredLineageRecord extends LineageRecordInput {
  createdAt: number;
}

// ---------------------------------------------------------------------------
// LineageTracker
// ---------------------------------------------------------------------------

const MAX_RECORDS = 10_000;

export class LineageTracker {
  private static instance: LineageTracker;

  /** Ordered insertion list (newest at end) */
  private readonly records: StoredLineageRecord[] = [];
  /** Fast lookup by lineageId */
  private readonly index = new Map<string, StoredLineageRecord>();

  private constructor() {}

  static getInstance(): LineageTracker {
    const g = globalThis as typeof globalThis & { __sriLineageTracker?: LineageTracker };
    if (!g.__sriLineageTracker) {
      g.__sriLineageTracker = new LineageTracker();
    }
    return g.__sriLineageTracker;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Record an agent execution in the lineage store.
   * This method is async to match the expected interface signature and to
   * allow future implementations to do async I/O without changing callers.
   */
  async record(input: LineageRecordInput): Promise<void> {
    const entry: StoredLineageRecord = {
      ...input,
      createdAt: Date.now(),
    };

    // Evict oldest records if at capacity
    if (this.records.length >= MAX_RECORDS) {
      const oldest = this.records.splice(0, Math.floor(MAX_RECORDS * 0.1));
      for (const r of oldest) {
        this.index.delete(r.lineageId);
      }
    }

    this.records.push(entry);
    this.index.set(entry.lineageId, entry);
  }

  /** Retrieve a single record by lineage ID. */
  get(lineageId: string): StoredLineageRecord | null {
    return this.index.get(lineageId) ?? null;
  }

  /** Return all records for a given session, newest-first. */
  getBySession(sessionId: string): StoredLineageRecord[] {
    return this.records
      .filter((r) => r.sessionId === sessionId)
      .reverse();
  }

  /** Return all records for a given user, newest-first. */
  getByUser(userId: string): StoredLineageRecord[] {
    return this.records
      .filter((r) => r.userId === userId)
      .reverse();
  }

  // -------------------------------------------------------------------------
  // API-route-compatible aliases (async wrappers for REST handler consumption)
  // -------------------------------------------------------------------------

  /** Retrieve a single lineage record by ID (async, for REST route use). */
  async getLineage(lineageId: string): Promise<StoredLineageRecord | null> {
    return this.get(lineageId);
  }

  /**
   * Return an ordered chain of all lineage records that share the same
   * sessionId as the given lineageId's record. Useful for tracing a full
   * conversation turn from user message through to response.
   */
  async getLineageChain(lineageId: string): Promise<StoredLineageRecord[]> {
    const root = this.get(lineageId);
    if (!root) return [];
    return this.records
      .filter((r) => r.sessionId === root.sessionId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Return all lineage records for a given session (async, for REST route use). */
  async getSessionLineage(sessionId: string): Promise<StoredLineageRecord[]> {
    return this.getBySession(sessionId);
  }

  /** Total number of records stored. */
  get size(): number {
    return this.records.length;
  }

  /** Clear all stored records (admin / test use). */
  clear(): void {
    this.records.length = 0;
    this.index.clear();
  }
}

// Pre-constructed singleton
export const lineageTracker = LineageTracker.getInstance();
