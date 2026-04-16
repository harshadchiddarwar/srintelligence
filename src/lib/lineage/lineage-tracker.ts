/**
 * LineageTracker — records data lineage for every agent execution and
 * provides retrieval methods for auditing and transparency.
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import type { AgentIntent } from '../../types/agent';
import type { LineageRecord } from '../../types/user';
import { executeSQL } from '../snowflake/sql-api';

// ---------------------------------------------------------------------------
// Record params
// ---------------------------------------------------------------------------

export interface RecordLineageParams {
  sessionId: string;
  userId: string;
  semanticViewId: string;
  semanticViewName: string;
  userQuestion: string;
  intent: AgentIntent;
  agentName: string;
  parentLineageId?: string;
  sourceSQL?: string;
  executedSQL?: string;
  rowCount?: number;
  executionTimeMs: number;
  cacheStatus: string;
  creditsConsumed?: number;
}

// ---------------------------------------------------------------------------
// LineageTracker (singleton)
// ---------------------------------------------------------------------------

export class LineageTracker {
  private static instance: LineageTracker;

  /** Buffered INSERT statements waiting to be flushed to Snowflake. */
  private readonly writeBuffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor() {}

  static getInstance(): LineageTracker {
    // Survive Next.js HMR module re-evaluation so the buffer isn't lost.
    const g = globalThis as typeof globalThis & { __sriLineageTracker2?: LineageTracker };
    if (!g.__sriLineageTracker2) {
      g.__sriLineageTracker2 = new LineageTracker();
    }
    return g.__sriLineageTracker2;
  }

  // ---------------------------------------------------------------------------
  // Record — synchronous return, background Snowflake write
  // ---------------------------------------------------------------------------

  /**
   * Records a lineage entry.  Returns the lineageId immediately (synchronous)
   * and fires the Snowflake INSERT in the background via a 2-second write buffer,
   * so the response stream is never blocked by lineage I/O.
   */
  record(params: RecordLineageParams): string {
    const lineageId = uuidv4();
    const sql = params.executedSQL ?? params.sourceSQL ?? '';

    const tables = this.extractTablesFromSQL(sql);
    const columns = this.extractColumnsFromSQL(sql);
    const filters = this.extractFiltersFromSQL(sql);

    const fingerprint = createHash('sha256')
      .update(`${params.sessionId}:${params.intent}:${sql}`)
      .digest('hex')
      .slice(0, 16);

    const escapedQuestion = params.userQuestion.replace(/'/g, "\\'");
    const escapedSQL = sql.replace(/'/g, "\\'");
    const escapedExSQL = (params.executedSQL ?? '').replace(/'/g, "\\'");
    const tablesJson = JSON.stringify(tables).replace(/'/g, "\\'");
    const columnsJson = JSON.stringify(columns).replace(/'/g, "\\'");
    const filtersJson = JSON.stringify(filters).replace(/'/g, "\\'");

    const insertSQL = `
      INSERT INTO CORTEX_TESTING.PUBLIC.DATA_LINEAGE (
        lineage_id, session_id, user_id, semantic_view_id, semantic_view_name,
        user_question, intent, agent_name, parent_lineage_id, source_sql,
        executed_sql, row_count, execution_time_ms, cache_status, credits_consumed
      ) VALUES (
        '${lineageId}',
        '${params.sessionId}',
        '${params.userId}',
        '${params.semanticViewId}',
        '${params.semanticViewName}',
        '${escapedQuestion}',
        '${params.intent}',
        '${params.agentName}',
        ${params.parentLineageId ? `'${params.parentLineageId}'` : 'NULL'},
        '${escapedSQL}',
        '${escapedExSQL}',
        ${params.rowCount ?? 'NULL'},
        ${params.executionTimeMs},
        '${params.cacheStatus}',
        ${params.creditsConsumed ?? 'NULL'}
      )
    `;

    this.enqueue(insertSQL);
    return lineageId;
  }

  // ---------------------------------------------------------------------------
  // Write buffer
  // ---------------------------------------------------------------------------

  private enqueue(sql: string): void {
    this.writeBuffer.push(sql);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush().catch((e) =>
          console.error('[LineageTracker] flush failed:', (e as Error).message),
        );
      }, 2_000); // batch writes every 2 seconds
    }
  }

  private async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) return;
    const batch = this.writeBuffer.splice(0);
    for (const sql of batch) {
      await executeSQL(sql).catch((e) =>
        console.error('[LineageTracker] INSERT failed:', (e as Error).message),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // SQL parsing helpers
  // ---------------------------------------------------------------------------

  private extractTablesFromSQL(sql: string): string[] {
    const regex = /(?:FROM|JOIN)\s+([\w.]+)/gi;
    const tables = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(sql)) !== null) {
      tables.add(match[1].toUpperCase());
    }
    return Array.from(tables);
  }

  private extractColumnsFromSQL(sql: string): string[] {
    const selectMatch = /SELECT\s+([\s\S]+?)\s+FROM/i.exec(sql);
    if (!selectMatch) return [];

    const selectClause = selectMatch[1];
    const columns = new Set<string>();

    const colRegex = /(?:^|,)\s*(?:[\w.]+\s+AS\s+)?([\w]+)\s*(?:,|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = colRegex.exec(selectClause)) !== null) {
      const col = match[1].trim().toUpperCase();
      if (col !== '*' && col !== 'NULL') columns.add(col);
    }

    return Array.from(columns);
  }

  private extractFiltersFromSQL(sql: string): string[] {
    const whereMatch = /WHERE\s+([\s\S]+?)(?:GROUP BY|ORDER BY|HAVING|LIMIT|$)/i.exec(sql);
    if (!whereMatch) return [];

    return whereMatch[1]
      .trim()
      .split(/\bAND\b|\bOR\b/i)
      .map((c) => c.trim())
      .filter((c) => c.length > 0 && c.length < 500);
  }

  // ---------------------------------------------------------------------------
  // Retrieval
  // ---------------------------------------------------------------------------

  async getLineage(lineageId: string): Promise<LineageRecord | null> {
    try {
      const result = await executeSQL(
        `SELECT * FROM CORTEX_TESTING.PUBLIC.DATA_LINEAGE WHERE lineage_id = '${lineageId}' LIMIT 1`,
      );
      if (result.rowCount === 0) return null;
      return this.rowToLineageRecord(result.rows[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async getLineageChain(lineageId: string): Promise<LineageRecord[]> {
    const chain: LineageRecord[] = [];
    let currentId: string | undefined = lineageId;
    while (currentId) {
      const record = await this.getLineage(currentId);
      if (!record) break;
      chain.unshift(record);
      currentId = undefined;
    }
    return chain;
  }

  async getSessionLineage(sessionId: string): Promise<LineageRecord[]> {
    try {
      const result = await executeSQL(
        `SELECT * FROM CORTEX_TESTING.PUBLIC.DATA_LINEAGE WHERE session_id = '${sessionId}' ORDER BY created_at ASC`,
      );
      return result.rows.map((r) => this.rowToLineageRecord(r as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  async getUserLineage(
    userId: string,
    params: {
      limit?: number;
      offset?: number;
      startDate?: string;
      endDate?: string;
      intent?: AgentIntent;
    } = {},
  ): Promise<LineageRecord[]> {
    const conditions: string[] = [`user_id = '${userId}'`];
    if (params.intent) conditions.push(`intent = '${params.intent}'`);
    if (params.startDate) conditions.push(`created_at >= '${params.startDate}'`);
    if (params.endDate) conditions.push(`created_at <= '${params.endDate}'`);

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const sql = `
      SELECT * FROM CORTEX_TESTING.PUBLIC.DATA_LINEAGE
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    try {
      const result = await executeSQL(sql);
      return result.rows.map((r) => this.rowToLineageRecord(r as Record<string, unknown>));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Row mapper
  // ---------------------------------------------------------------------------

  private rowToLineageRecord(row: Record<string, unknown>): LineageRecord {
    return {
      lineageId: String(row['LINEAGE_ID'] ?? ''),
      sessionId: String(row['SESSION_ID'] ?? ''),
      userId: String(row['USER_ID'] ?? ''),
      intent: (row['INTENT'] as AgentIntent) ?? 'UNKNOWN',
      nodes: [
        {
          nodeId: String(row['LINEAGE_ID'] ?? ''),
          type: 'agent',
          label: String(row['AGENT_NAME'] ?? ''),
          startedAt: row['CREATED_AT'] ? new Date(String(row['CREATED_AT'])).getTime() : Date.now(),
          metadata: {
            semanticViewId: row['SEMANTIC_VIEW_ID'],
            cacheStatus: row['CACHE_STATUS'],
            rowCount: row['ROW_COUNT'],
            executionTimeMs: row['EXECUTION_TIME_MS'],
          },
        },
      ],
      edges: [],
      createdAt: row['CREATED_AT'] ? new Date(String(row['CREATED_AT'])).getTime() : Date.now(),
    };
  }
}

export const lineageTracker = LineageTracker.getInstance();
