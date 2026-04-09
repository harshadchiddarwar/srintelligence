/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * DBSCANClusterAgent — density-based spatial clustering via
 * CORTEX_TESTING.ML.CLUSTER_DBSCAN table-valued function.
 *
 * SQL pattern (ALWAYS use TABLE(), NEVER CALL):
 *   SELECT * FROM TABLE(CORTEX_TESTING.ML.CLUSTER_DBSCAN(CURSOR(...), eps, min_samples))
 *
 * DBSCAN does not require specifying the number of clusters in advance.
 * Cluster IDs of -1 indicate noise/outlier points.
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';
import { buildClusterSegments } from './clustering-agent';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_EPS = 0.5;
const DEFAULT_MIN_SAMPLES = 5;

// ---------------------------------------------------------------------------
// DBSCANClusterAgent
// ---------------------------------------------------------------------------

export class DBSCANClusterAgent extends BaseAgent {
  readonly name = 'cluster-dbscan';
  readonly displayName = 'DBSCAN Clustering';
  readonly description =
    'Density-based spatial clustering — discovers arbitrarily-shaped clusters and labels outliers using CORTEX_TESTING.ML.CLUSTER_DBSCAN.';
  readonly intent: AgentIntent = 'CLUSTER_DBSCAN';

  validateInput(input: AgentInput): ValidationResult {
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return { valid: false, error: 'sourceSQL must be a non-empty SQL string.' };
    }
    const eps = input.extraContext?.eps as number | undefined;
    if (eps !== undefined && eps <= 0) {
      return { valid: false, error: 'eps must be a positive float.' };
    }
    const minSamples = input.extraContext?.minSamples as number | undefined;
    if (minSamples !== undefined && (minSamples < 1 || !Number.isInteger(minSamples))) {
      return { valid: false, error: 'minSamples must be a positive integer.' };
    }
    return { valid: true };
  }

  buildSQL(input: AgentInput): string {
    const sourceSQL = input.extraContext!.sourceSQL as string;
    const eps = (input.extraContext?.eps as number | undefined) ?? DEFAULT_EPS;
    const minSamples = (input.extraContext?.minSamples as number | undefined) ?? DEFAULT_MIN_SAMPLES;

    return [
      `WITH SOURCE_DATA AS (`,
      sourceSQL.trim(),
      `)`,
      `SELECT * FROM TABLE(CORTEX_TESTING.ML.CLUSTER_DBSCAN(`,
      `  CURSOR(SELECT * FROM SOURCE_DATA),`,
      `  ${eps},`,
      `  ${minSamples}`,
      `))`,
      `ORDER BY CLUSTER_ID`,
    ].join('\n');
  }

  parseResults(
    rows: Record<string, unknown>[],
    columns: string[],
    input: AgentInput,
  ): ParsedData {
    if (rows.length === 0) {
      return {
        data: { type: 'cluster', segments: [], summary: 'No clustering results returned.' },
        narrative: 'DBSCAN clustering returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    // Separate noise (-1) from proper clusters
    const cleanRows = rows.filter(
      (r) => Number(r['CLUSTER_ID'] ?? r['cluster_id']) !== -1,
    );
    const noiseCount = rows.length - cleanRows.length;

    const segments = buildClusterSegments(cleanRows, columns);
    const eps = (input.extraContext?.eps as number | undefined) ?? DEFAULT_EPS;
    const minSamples = (input.extraContext?.minSamples as number | undefined) ?? DEFAULT_MIN_SAMPLES;

    const narrative =
      `DBSCAN clustering complete (eps=${eps}, minSamples=${minSamples}). ` +
      `${segments.length} cluster(s) identified across ${cleanRows.length} records` +
      (noiseCount > 0 ? `; ${noiseCount} noise/outlier point(s) detected.` : '.');

    return {
      data: {
        type: 'cluster',
        segments,
        summary: narrative,
        algorithm: 'CLUSTER_DBSCAN',
        noiseCount,
        eps,
        minSamples,
        totalRecords: rows.length,
      },
      narrative,
      metadata: { rowCount: rows.length, segmentCount: segments.length, noiseCount },
    };
  }
}

export const dbscanAgent = new DBSCANClusterAgent();
