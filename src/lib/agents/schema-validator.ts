/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * SchemaValidator — dry-runs analyst SQL to retrieve column metadata
 * without executing the full query.
 *
 * Used by the two-pass data preparation pipeline so SQLTransformer can
 * inspect actual column names and sample values before building the
 * schema-compliant CTE wrapper.
 */

import { executeSQL } from '../snowflake/sql-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DryRunResult {
  columns: string[];
  sampleRow: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// SchemaValidator
// ---------------------------------------------------------------------------

export class SchemaValidator {
  /**
   * Execute `WITH dry_run AS (<sql>) SELECT * FROM dry_run LIMIT 1`
   * to retrieve column names and one sample row cheaply.
   *
   * Returns an error string instead of throwing so callers can decide whether
   * to fall back to the raw SQL or surface the error.
   */
  static async dryRun(sql: string, signal?: AbortSignal): Promise<DryRunResult> {
    const dryRunSql = `WITH dry_run AS (\n${sql.trim()}\n) SELECT * FROM dry_run LIMIT 1`;

    try {
      const result = await executeSQL(dryRunSql, undefined, signal);
      const sampleRow: Record<string, unknown> = result.rows[0] ?? {};
      return { columns: result.columns, sampleRow };
    } catch (err) {
      return {
        columns: [],
        sampleRow: {},
        error: `Dry-run failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
