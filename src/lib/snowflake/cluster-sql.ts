/**
 * Snowflake Node.js driver client for long-running clustering UDTF queries.
 *
 * The SQL REST API goes async after 45 seconds, requiring polling that can
 * 408-timeout for clustering UDTFs (30-180s).  The Node.js driver holds the
 * connection open until the query completes natively — no async cutoff.
 *
 * Auth mirrors auth.ts:
 *   PAT  (SNOWFLAKE_PAT)           → OAUTH authenticator
 *   JWT  (SNOWFLAKE_PRIVATE_KEY)   → SNOWFLAKE_JWT authenticator
 */

// snowflake-sdk is CommonJS — use require() to avoid ESM interop issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const snowflake = require('snowflake-sdk') as typeof import('snowflake-sdk');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCOUNT   = process.env.SNOWFLAKE_ACCOUNT   ?? '';
const USERNAME  = process.env.SNOWFLAKE_USERNAME   ?? '';
const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE  ?? '';
const DATABASE  = process.env.SNOWFLAKE_DATABASE   ?? 'CORTEX_TESTING';
const ROLE      = process.env.SNOWFLAKE_ROLE       ?? 'APP_SVC_ROLE';

/** Max seconds a clustering query may run before the driver times it out. */
const CLUSTER_TIMEOUT_S = 300; // 5 minutes

// ---------------------------------------------------------------------------
// Connection factory
// ---------------------------------------------------------------------------

function buildConnectionOptions(): Parameters<typeof snowflake.createConnection>[0] {
  const base = {
    account:   ACCOUNT,
    username:  USERNAME,
    warehouse: WAREHOUSE,
    database:  DATABASE,
    schema:    'PUBLIC',
    role:      ROLE,
    clientSessionKeepAlive: true,
  };

  if (process.env.SNOWFLAKE_PAT) {
    return {
      ...base,
      authenticator: 'PROGRAMMATIC_ACCESS_TOKEN',
      token: process.env.SNOWFLAKE_PAT,
    };
  }

  if (process.env.SNOWFLAKE_PRIVATE_KEY) {
    return {
      ...base,
      authenticator: 'SNOWFLAKE_JWT',
      privateKey: process.env.SNOWFLAKE_PRIVATE_KEY,
    };
  }

  throw new Error(
    'cluster-sql: No Snowflake credentials found. Set SNOWFLAKE_PAT or SNOWFLAKE_PRIVATE_KEY.',
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ClusterSQLResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  queryId: string;
}

/**
 * Execute a clustering UDTF SELECT using the Snowflake Node.js driver.
 *
 * Opens a fresh connection per call — safe for Next.js multi-worker environments
 * where connection state cannot be shared across requests.
 */
export async function executeClusteringSQL(
  sql: string,
  signal?: AbortSignal,
): Promise<ClusterSQLResult> {
  // Strip semicolons (driver may also reject them but be safe)
  const cleanSQL = sql.replace(/;/g, '').trim();

  const connOptions = buildConnectionOptions();
  const conn = snowflake.createConnection(connOptions);

  // Connect
  await new Promise<void>((resolve, reject) => {
    conn.connect((err) => {
      if (err) reject(new Error(`Snowflake driver connect failed: ${err.message}`));
      else resolve();
    });
  });

  console.log('[CLUSTER_SDK] Connected. Executing UDTF SQL...');

  try {
    const result = await new Promise<ClusterSQLResult>((resolve, reject) => {
      // Abort handling: destroy the connection if the signal fires
      const onAbort = () => {
        conn.destroy((destroyErr) => {
          if (destroyErr) console.warn('[CLUSTER_SDK] Destroy on abort failed:', destroyErr.message);
        });
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      conn.execute({
        sqlText: cleanSQL,
        streamResult: false,
        fetchAsString: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        complete: (err: Error | undefined, stmt: any, rows: Record<string, unknown>[] | undefined) => {
          signal?.removeEventListener('abort', onAbort);

          if (err) {
            reject(new Error(`Clustering UDTF failed: ${err.message}`));
            return;
          }

          const rawRows: Record<string, unknown>[] = rows ?? [];
          const columns: string[] =
            rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
          const queryId: string = stmt?.getStatementId?.() ?? '';

          console.log(
            `[CLUSTER_SDK] Query complete: queryId=${queryId} rows=${rawRows.length} columns=[${columns.join(', ')}]`,
          );

          resolve({ columns, rows: rawRows, rowCount: rawRows.length, queryId });
        },
      });
    });

    return result;
  } finally {
    // Always close the connection
    conn.destroy((err) => {
      if (err) console.warn('[CLUSTER_SDK] Connection destroy failed:', err.message);
    });
  }
}
