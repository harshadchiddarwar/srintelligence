/**
 * Snowflake SQL API v2 client.
 *
 * Features:
 *  - Synchronous (200) and asynchronous (202) execution with polling
 *  - Optional USE ROLE prepend via MULTI_STATEMENT_COUNT header
 *  - Pagination via partitionInfo
 *  - Typed rows mapped by column name
 */

import { authManager } from './auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = `https://${process.env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com`;
const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE ?? 'CORTEX_WH';
const DATABASE = process.env.SNOWFLAKE_DATABASE ?? 'CORTEX_TESTING';
const POLL_INTERVAL_MS = 2_000;
const STATEMENT_TIMEOUT_S = 120;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SQLResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  sql: string;
}

export class SnowflakeError extends Error {
  code?: string;
  sqlState?: string;
  sql?: string;

  constructor(
    message: string,
    options?: { code?: string; sqlState?: string; sql?: string },
  ) {
    super(message);
    this.name = 'SnowflakeError';
    this.code = options?.code;
    this.sqlState = options?.sqlState;
    this.sql = options?.sql;
  }
}

// ---------------------------------------------------------------------------
// Internal Snowflake API response shapes
// ---------------------------------------------------------------------------

interface SnowflakeRowType {
  name: string;
  type: string;
  nullable: boolean;
  byteLength: number | null;
  length: number | null;
  scale: number | null;
  precision: number | null;
}

interface SnowflakePartitionInfo {
  rowCount: number;
  uncompressedSize: number;
}

interface SnowflakeResultSetMetaData {
  rowType: SnowflakeRowType[];
  partitionInfo?: SnowflakePartitionInfo[];
}

interface SnowflakeStatementResponse {
  statementHandle?: string;
  resultSetMetaData?: SnowflakeResultSetMetaData;
  data?: (string | null)[][];
  code?: string;
  sqlState?: string;
  message?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

function buildRows(
  columnNames: string[],
  rawRows: (string | null)[][],
): Record<string, unknown>[] {
  return rawRows.map((rawRow) => {
    const record: Record<string, unknown> = {};
    columnNames.forEach((col, idx) => {
      record[col] = rawRow[idx] ?? null;
    });
    return record;
  });
}

async function fetchPartition(
  handle: string,
  partition: number,
  headers: Record<string, string>,
): Promise<(string | null)[][]> {
  const url = `${BASE_URL}/api/v2/statements/${handle}?partition=${partition}`;
  const response = await fetch(url, { method: 'GET', headers });

  if (!response.ok) {
    throw new SnowflakeError(
      `Failed to fetch partition ${partition}: HTTP ${response.status}`,
    );
  }

  const json = (await response.json()) as SnowflakeStatementResponse;
  return json.data ?? [];
}

async function pollForResult(
  handle: string,
  headers: Record<string, string>,
): Promise<SnowflakeStatementResponse> {
  const url = `${BASE_URL}/api/v2/statements/${handle}`;

  for (;;) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const response = await fetch(url, { method: 'GET', headers });

    if (!response.ok) {
      throw new SnowflakeError(`Async poll failed: HTTP ${response.status}`);
    }

    const json = (await response.json()) as SnowflakeStatementResponse;
    const status = json.status ?? '';

    if (status === 'RUNNING' || status === 'QUEUED') {
      continue;
    }

    if (status === 'FAILED_WITH_ERROR') {
      throw new SnowflakeError(json.message ?? 'Statement failed', {
        code: json.code,
        sqlState: json.sqlState,
      });
    }

    // SUCCESS or any other terminal state
    return json;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a SQL statement via the Snowflake SQL API v2.
 *
 * @param sql       - The SQL to execute.
 * @param userRole  - Optional Snowflake role. If provided, a USE ROLE statement
 *                    is prepended using a multi-statement request.
 */
export async function executeSQL(sql: string, userRole?: string): Promise<SQLResult> {
  const headers = await authManager.getAuthHeaders();

  let statement = sql;
  const extraHeaders: Record<string, string> = {};

  if (userRole) {
    const safeRole = userRole.replace(/[^A-Za-z0-9_$]/g, '');
    statement = `USE ROLE ${safeRole};\n${sql}`;
    // 0 = no fixed count; Snowflake uses MULTI_STATEMENT_COUNT: "0" to allow
    // any number of statements in a single request.
    extraHeaders['MULTI_STATEMENT_COUNT'] = '0';
  }

  const requestBody = {
    statement,
    timeout: STATEMENT_TIMEOUT_S,
    warehouse: WAREHOUSE,
    database: DATABASE,
    schema: 'PUBLIC',
    resultSetMetaData: { format: 'json' },
  };

  const response = await fetch(`${BASE_URL}/api/v2/statements`, {
    method: 'POST',
    headers: { ...headers, ...extraHeaders },
    body: JSON.stringify(requestBody),
  });

  let json: SnowflakeStatementResponse;

  if (response.status === 200) {
    // Synchronous result
    json = (await response.json()) as SnowflakeStatementResponse;
  } else if (response.status === 202) {
    // Asynchronous — poll until done
    const accepted = (await response.json()) as SnowflakeStatementResponse;
    const handle = accepted.statementHandle;
    if (!handle) {
      throw new SnowflakeError('Async statement returned no statementHandle');
    }
    json = await pollForResult(handle, headers);
  } else {
    const errorJson = (await response.json().catch(() => ({}))) as SnowflakeStatementResponse;
    throw new SnowflakeError(
      errorJson.message ?? `Snowflake SQL API error: HTTP ${response.status}`,
      { code: errorJson.code, sqlState: errorJson.sqlState, sql },
    );
  }

  // Check for error in the body even on 200
  if (json.code && json.message) {
    throw new SnowflakeError(json.message, {
      code: json.code,
      sqlState: json.sqlState,
      sql,
    });
  }

  const metadata = json.resultSetMetaData;
  if (!metadata) {
    throw new SnowflakeError('Response missing resultSetMetaData', { sql });
  }

  const columnNames = metadata.rowType.map((col) => col.name);
  const primaryData = json.data ?? [];
  let allRows: (string | null)[][] = [...primaryData];

  // Fetch additional partitions if present
  const partitionInfo = metadata.partitionInfo ?? [];
  if (partitionInfo.length > 1 && json.statementHandle) {
    const handle = json.statementHandle;
    const partitionFetches = Array.from({ length: partitionInfo.length - 1 }, (_, i) =>
      fetchPartition(handle, i + 1, headers),
    );
    const extraPartitions = await Promise.all(partitionFetches);
    for (const part of extraPartitions) {
      allRows = allRows.concat(part);
    }
  }

  const rows = buildRows(columnNames, allRows);

  return {
    columns: columnNames,
    rows,
    rowCount: rows.length,
    sql,
  };
}
