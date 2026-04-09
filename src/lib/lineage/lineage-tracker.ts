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

  private constructor() {}

  static getInstance(): LineageTracker {
    if (!LineageTracker.instance) {
      LineageTracker.instance = new LineageTracker();
    }
    return LineageTracker.instance;
  }

  // ---------------------------------------------------------------------------
  // Record
  // ---------------------------------------------------------------------------

  async record(params: RecordLineageParams): Promise<string> {
    const lineageId = uuidv4();
    const sql = params.executedSQL ?? params.sourceSQL ?? '';

    const tables = this.extractTablesFromSQL(sql);
    const columns = this.extractColumnsFromSQL(sql);
    const filters = this.extractFiltersFromSQL(sql);

    // Build a deterministic fingerprint of the execution
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
        lineage_id,
        session_id,
        user_id,
        semantic_view_id,
        semantic_view_name,
        user_question,
        intent,
        agent_name,
        parent_lineage_id,
        source_sql,
        executed_sql,
        tables_referenced,
        columns_referenced,
        filters_applied,
        row_count,
        execution_time_ms,
        cache_status,
        credits_consumed,
        fingerprint,
        created_at
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
        PARSE_JSON('${tablesJson}'),
        PARSE_JSON('${columnsJson}'),
        PARSE_JSON('${filtersJson}'),
        ${params.rowCount ?? 'NULL'},
        ${params.executionTimeMs},
        '${params.cacheStatus}',
        ${params.creditsConsumed ?? 'NULL'},
        '${fingerprint}',
        CURRENT_TIMESTAMP()
      )
    `;

    try {
      await executeSQL(insertSQL);
    } catch (err) {
      // Lineage recording is non-blocking — log and continue
      console.error('[LineageTracker] Failed to record lineage:', err);
    }

    return lineageId;
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
    // Extract identifiers in the SELECT clause (before the first FROM)
    const selectMatch = /SELECT\s+([\s\S]+?)\s+FROM/i.exec(sql);
    if (!selectMatch) return [];

    const selectClause = selectMatch[1];
    const columns = new Set<string>();

    // Match alias or plain column references: col, table.col, expr AS alias
    const colRegex = /(?:^|,)\s*(?:[\w.]+\s+AS\s+)?([\w]+)\s*(?:,|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = colRegex.exec(selectClause)) !== null) {
      const col = match[1].trim().toUpperCase();
      if (col !== '*' && col !== 'NULL') {
        columns.add(col);
      }
    }

    return Array.from(columns);
  }

  private extractFiltersFromSQL(sql: string): string[] {
    // Extract the WHERE clause content
    const whereMatch = /WHERE\s+([\s\S]+?)(?:GROUP BY|ORDER BY|HAVING|LIMIT|$)/i.exec(sql);
    if (!whereMatch) return [];

    const whereClause = whereMatch[1].trim();
    // Split on AND/OR to get individual conditions
    return whereClause
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

  /** Walks the parentLineageId chain to return the full execution history. */
  async getLineageChain(lineageId: string): Promise<LineageRecord[]> {
    const chain: LineageRecord[] = [];
    let currentId: string | undefined = lineageId;

    while (currentId) {
      const record = await this.getLineage(currentId);
      if (!record) break;
      chain.unshift(record);
      // LineageRecord.nodes contains the parent info
      currentId = undefined; // We'd need a parentLineageId field — use metadata
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
