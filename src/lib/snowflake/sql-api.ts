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
const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE;
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

const DATE_TYPES = new Set(['date', 'timestamp_ntz', 'timestamp_ltz', 'timestamp_tz']);

/** Format a UTC Date as MM/DD/YY */
function formatDateUTC(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

/**
 * Map raw Snowflake SQL API rows to objects using column metadata.
 * Date/timestamp columns (identified by rowType.type) are formatted as MM/DD/YY.
 * Snowflake returns:
 *   - DATE as epoch-day count string (e.g. "19723")
 *   - TIMESTAMP_* as epoch-seconds string (e.g. "1704067200.000000000")
 */
function buildRows(
  rowType: SnowflakeRowType[],
  rawRows: (string | null)[][],
): Record<string, unknown>[] {
  const dateIndices = new Set(
    rowType
      .map((col, idx) => (DATE_TYPES.has(col.type.toLowerCase()) ? idx : -1))
      .filter((i) => i >= 0),
  );

  return rawRows.map((rawRow) => {
    const record: Record<string, unknown> = {};
    rowType.forEach((col, idx) => {
      const raw = rawRow[idx];
      if (raw == null) {
        record[col.name] = null;
        return;
      }
      const trimmed = raw.trim();
      if (dateIndices.has(idx)) {
        if (col.type.toLowerCase() === 'date') {
          // Epoch-day count → Date
          const epochDay = parseInt(trimmed, 10);
          record[col.name] = !isNaN(epochDay)
            ? formatDateUTC(new Date(epochDay * 86_400_000))
            : trimmed;
        } else {
          // Epoch-seconds (possibly fractional) → Date
          const epochSec = parseFloat(trimmed);
          record[col.name] = !isNaN(epochSec)
            ? formatDateUTC(new Date(epochSec * 1_000))
            : trimmed;
        }
      } else {
        record[col.name] = trimmed;
      }
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

/** Cancel a running Snowflake statement via DELETE /api/v2/statements/{handle} */
async function cancelSnowflakeStatement(
  handle: string,
  headers: Record<string, string>,
): Promise<void> {
  try {
    await fetch(`${BASE_URL}/api/v2/statements/${handle}/cancel`, {
      method: 'POST',
      headers,
    });
  } catch {
    // Best-effort — ignore network errors on cancel
  }
}

async function pollForResult(
  handle: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<SnowflakeStatementResponse> {
  const url = `${BASE_URL}/api/v2/statements/${handle}`;
  let pollCount = 0;

  for (;;) {
    // Abort-aware sleep: resolves after POLL_INTERVAL_MS or rejects immediately on abort
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const timer = setTimeout(resolve, POLL_INTERVAL_MS);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });

    // Cancel on Snowflake and propagate
    if (signal?.aborted) {
      await cancelSnowflakeStatement(handle, headers);
      throw new DOMException('Aborted', 'AbortError');
    }

    pollCount++;
    const response = await fetch(url, { method: 'GET', headers, signal });
    console.log(`SQL_API_POLL_${pollCount}: status=${response.status}`);

    if (!response.ok) {
      throw new SnowflakeError(`Async poll failed: HTTP ${response.status}`);
    }

    const json = (await response.json()) as SnowflakeStatementResponse;
    const status = json.status ?? '';

    if (status === 'RUNNING' || status === 'QUEUED') {
      // Check once more after getting the response (race condition guard)
      if (signal?.aborted) {
        await cancelSnowflakeStatement(handle, headers);
        throw new DOMException('Aborted', 'AbortError');
      }
      continue;
    }

    if (status === 'FAILED_WITH_ERROR') {
      throw new SnowflakeError(json.message ?? 'Statement failed', {
        code: json.code,
        sqlState: json.sqlState,
      });
    }

    // SUCCESS or any other terminal state
    console.log('SQL_API_POLL_COUNT:', pollCount);
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
export async function executeSQL(sql: string, userRole?: string, signal?: AbortSignal): Promise<SQLResult> {
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

  console.time('SQL_API_POST');
  const response = await fetch(`${BASE_URL}/api/v2/statements`, {
    method: 'POST',
    headers: { ...headers, ...extraHeaders },
    signal,
    body: JSON.stringify(requestBody),
  });
  console.timeEnd('SQL_API_POST');
  console.log('SQL_API_STATUS:', response.status);

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
    // Register an immediate cancel if the signal is already fired
    if (signal?.aborted) {
      await cancelSnowflakeStatement(handle, headers);
      throw new DOMException('Aborted', 'AbortError');
    }
    // Also cancel on Snowflake if the signal fires while we're polling
    signal?.addEventListener('abort', () => {
      cancelSnowflakeStatement(handle, headers).catch(() => {});
    }, { once: true });
    console.time('SQL_API_POLL');
    json = await pollForResult(handle, headers, signal);
    console.timeEnd('SQL_API_POLL');
  } else {
    const errorJson = (await response.json().catch(() => ({}))) as SnowflakeStatementResponse;
    throw new SnowflakeError(
      errorJson.message ?? `Snowflake SQL API error: HTTP ${response.status}`,
      { code: errorJson.code, sqlState: errorJson.sqlState, sql },
    );
  }

  // A successful Snowflake response includes resultSetMetaData.
  // If it's absent the body is an error payload (even on HTTP 200).
  const metadata = json.resultSetMetaData;
  if (!metadata) {
    throw new SnowflakeError(json.message ?? 'Response missing resultSetMetaData', {
      code: json.code,
      sqlState: json.sqlState,
      sql,
    });
  }

  const { rowType } = metadata;
  const columnNames = rowType.map((col) => col.name);

  // Log column schema — tells us which columns Snowflake reports as date/timestamp
  console.log('[SQL_API] rowType:', rowType.map((c) => `${c.name}:${c.type}`).join(', '));

  const primaryData = json.data ?? [];
  let allRows: (string | null)[][] = [...primaryData];

  // Log raw first row so we can see epoch values before conversion
  if (primaryData[0]) {
    console.log('[SQL_API] raw row[0]:', JSON.stringify(primaryData[0]));
  }

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

  const rows = buildRows(rowType, allRows);

  // Log parsed first row so we can confirm date formatting was applied
  if (rows[0]) {
    console.log('[SQL_API] parsed row[0]:', JSON.stringify(rows[0]));
  }
  console.log('[SQL_API] rowCount:', rows.length);

  return {
    columns: columnNames,
    rows,
    rowCount: rows.length,
    sql,
  };
}
