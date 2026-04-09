/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * SQLTransformer — programmatically wraps raw Cortex Analyst SQL in a CTE
 * that matches the schema expected by each downstream ML agent.
 *
 * This is the second pass of the two-pass data preparation pipeline:
 *   Pass 1: natural language → raw SQL (Cortex Analyst)
 *   Pass 2: raw SQL + column metadata → schema-compliant SQL (SQLTransformer)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransformResult {
  sql: string;
  dateCol?: string;
  valueCol?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// SQLTransformer
// ---------------------------------------------------------------------------

export class SQLTransformer {
  // -------------------------------------------------------------------------
  // Forecast: produce WEEK_DATE + METRIC_VALUE
  // -------------------------------------------------------------------------

  static transformForForecast(
    analystSql: string,
    columns: string[],
    sampleRow: Record<string, unknown>,
  ): TransformResult {
    const dateCol = columns.find((c) => this.isDateColumn(c));
    const valueCol = columns.find(
      (c) => !this.isDateColumn(c) && this.isNumericColumn(c, sampleRow[c]),
    );

    if (!dateCol) {
      return {
        sql: '',
        error: `Could not identify a date column for forecast. Available: ${columns.join(', ')}`,
      };
    }
    if (!valueCol) {
      return {
        sql: '',
        error: `Could not identify a numeric value column for forecast. Available: ${columns.join(', ')}`,
      };
    }

    const sql = `
WITH analyst_data AS (
${analystSql.trim()}
)
SELECT
  DATE_TRUNC('week', TRY_TO_DATE(${dateCol}::VARCHAR)) AS WEEK_DATE,
  SUM(${valueCol}::FLOAT) AS METRIC_VALUE
FROM analyst_data
WHERE ${dateCol} IS NOT NULL
GROUP BY 1
ORDER BY 1 ASC
`.trim();

    return { sql, dateCol: 'WEEK_DATE', valueCol: 'METRIC_VALUE' };
  }

  // -------------------------------------------------------------------------
  // Cluster: produce id col + all numeric feature columns, LIMIT 5000
  // -------------------------------------------------------------------------

  static transformForCluster(
    analystSql: string,
    columns: string[],
    sampleRow: Record<string, unknown>,
  ): TransformResult {
    const idCol = columns.find((c) => this.isIdColumn(c)) ?? columns[0];
    const numericCols = columns.filter(
      (c) => c !== idCol && this.isNumericColumn(c, sampleRow[c]),
    );

    if (numericCols.length === 0) {
      return {
        sql: '',
        error: `No numeric feature columns found for clustering. Available: ${columns.join(', ')}`,
      };
    }

    const selectParts = [
      idCol,
      ...numericCols.map((c) => `COALESCE(${c}::FLOAT, 0) AS ${c}`),
    ];

    const sql = `
WITH analyst_data AS (
${analystSql.trim()}
)
SELECT
  ${selectParts.join(',\n  ')}
FROM analyst_data
ORDER BY ${numericCols[0]} DESC NULLS LAST
LIMIT 5000
`.trim();

    return { sql };
  }

  // -------------------------------------------------------------------------
  // mTree: produce SEGMENT + BASELINE_SHARE + TARGET_SHARE + SEGMENT_WEIGHT
  // -------------------------------------------------------------------------

  static transformForMTree(
    analystSql: string,
    columns: string[],
    sampleRow: Record<string, unknown>,
  ): TransformResult {
    const dimCol = columns.find((c) => this.isDimensionColumn(c, sampleRow[c]));

    if (!dimCol) {
      return {
        sql: '',
        error: `No dimension column found for mTree analysis. Available: ${columns.join(', ')}`,
      };
    }

    const numericCols = columns.filter(
      (c) => c !== dimCol && this.isNumericColumn(c, sampleRow[c]),
    );

    // Prefer columns whose names suggest share/rate for the share expression
    const shareCol = numericCols.find((c) =>
      /share|rate|pct|percent|brand/i.test(c),
    );
    const totalCol = numericCols.find((c) =>
      /total|all|count|volume/i.test(c),
    );

    let baselineShareExpr: string;
    let targetShareExpr: string;
    let segmentWeightExpr: string;

    if (shareCol && totalCol) {
      baselineShareExpr = `COALESCE(${shareCol}::FLOAT, 0)`;
      targetShareExpr = `COALESCE(${shareCol}::FLOAT, 0)`;
      segmentWeightExpr = `COALESCE(${totalCol}::INT, 1)`;
    } else if (numericCols.length >= 2) {
      const [num, den] = numericCols;
      baselineShareExpr = `CASE WHEN COALESCE(${den}::FLOAT, 0) > 0 THEN COALESCE(${num}::FLOAT, 0) / ${den}::FLOAT ELSE 0 END`;
      targetShareExpr = baselineShareExpr;
      segmentWeightExpr = `COALESCE(${den}::INT, 1)`;
    } else if (numericCols.length === 1) {
      baselineShareExpr = `COALESCE(${numericCols[0]}::FLOAT, 0)`;
      targetShareExpr = baselineShareExpr;
      segmentWeightExpr = '1';
    } else {
      return {
        sql: '',
        error: `Insufficient numeric columns for mTree transformation. Available: ${columns.join(', ')}`,
      };
    }

    const sql = `
WITH analyst_data AS (
${analystSql.trim()}
)
SELECT
  ${dimCol} AS SEGMENT,
  ${baselineShareExpr} AS BASELINE_SHARE,
  ${targetShareExpr} AS TARGET_SHARE,
  ${segmentWeightExpr} AS SEGMENT_WEIGHT
FROM analyst_data
WHERE ${dimCol} IS NOT NULL
`.trim();

    return { sql };
  }

  // -------------------------------------------------------------------------
  // Column classification helpers
  // -------------------------------------------------------------------------

  static isDateColumn(name: string): boolean {
    return /date|week|month|year|period|time|day/i.test(name);
  }

  static isNumericColumn(name: string, value: unknown): boolean {
    if (typeof value === 'number') return true;
    if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value.trim()))) return true;
    return /count|sum|avg|total|rate|share|amount|pay|weight|claims|patients|drugs|supply|cost|charge|qty|quantity|value|metric|score|pct|percent/i.test(
      name,
    );
  }

  static isIdColumn(name: string): boolean {
    return /key$|_key$|_id$|^id_|^npi|physician|provider|prescriber/i.test(name);
  }

  static isDimensionColumn(name: string, value: unknown): boolean {
    if (typeof value === 'string' && value.trim() !== '' && isNaN(Number(value.trim()))) return true;
    return /segment|group|type|category|class|channel|region|brand|drug|product|specialty|tier/i.test(
      name,
    );
  }
}
