/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * KMedoidsClusterAgent — K-Medoids (PAM) clustering via
 * CORTEX_TESTING.ML.KMEDOIDS_CLUSTER stored procedure.
 *
 * SQL pattern — ALWAYS use CALL with a dollar-quoted input query string:
 *   CALL CORTEX_TESTING.ML.KMEDOIDS_CLUSTER($$<input_query>$$, n_clusters)
 *
 * K-Medoids is more robust to outliers than K-Means because cluster
 * centers are actual data points (medoids), not coordinate means.
 * Pass 0 to let the procedure auto-detect the optimum k.
 * Results are written to CORTEX_TESTING.PUBLIC.CLUSTERING_RESULTS.
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';
import { buildClusterSegments } from './clustering-agent';

const DEFAULT_N_CLUSTERS = 5;

export class KMedoidsClusterAgent extends BaseAgent {
  readonly name = 'cluster-kmedoids';
  readonly displayName = 'K-Medoids Clustering';
  readonly description =
    'K-Medoids (PAM) clustering — robust to outliers, uses actual data points as centers via CORTEX_TESTING.ML.CLUSTER_KMEDOIDS.';
  readonly intent: AgentIntent = 'CLUSTER_KMEDOIDS';

  validateInput(input: AgentInput): ValidationResult {
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return { valid: false, error: 'sourceSQL must be a non-empty SQL string.' };
    }
    const n = input.extraContext?.nSegments as number | undefined;
    if (n !== undefined && (n < 2 || n > 50)) {
      return { valid: false, error: 'nSegments must be between 2 and 50.' };
    }
    return { valid: true };
  }

  buildSQL(input: AgentInput): string {
    const sourceSQL = input.extraContext!.sourceSQL as string;
    const nClusters = (input.extraContext?.nSegments as number | undefined) ?? DEFAULT_N_CLUSTERS;

    // Procedures are called with CALL, not SELECT * FROM TABLE().
    // The input query is passed as a dollar-quoted VARCHAR; n_clusters=0 → auto-detect.
    return `CALL CORTEX_TESTING.ML.KMedoids_cluster($$${sourceSQL.trim()}$$, ${nClusters})`;
  }

  parseResults(
    rows: Record<string, unknown>[],
    columns: string[],
    input: AgentInput,
  ): ParsedData {
    if (rows.length === 0) {
      return {
        data: { type: 'cluster', segments: [], summary: 'No clustering results returned.' },
        narrative: 'K-Medoids clustering returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const segments = buildClusterSegments(rows, columns);
    const nClusters = (input.extraContext?.nSegments as number | undefined) ?? DEFAULT_N_CLUSTERS;

    // Check which rows are medoids (CORTEX_TESTING.ML.CLUSTER_KMEDOIDS may include IS_MEDOID col)
    const medoidCount = rows.filter(
      (r) => r['IS_MEDOID'] === true || r['IS_MEDOID'] === 1 || r['is_medoid'] === true,
    ).length;

    const narrative =
      `K-Medoids clustering complete (k=${nClusters}). ` +
      `${segments.length} cluster(s) identified across ${rows.length} records` +
      (medoidCount > 0 ? `; ${medoidCount} medoid(s) identified.` : '.');

    return {
      data: {
        type: 'cluster',
        segments,
        summary: narrative,
        algorithm: 'CLUSTER_KMEDOIDS',
        requestedSegments: nClusters,
        medoidCount,
        totalRecords: rows.length,
      },
      narrative,
      metadata: { rowCount: rows.length, segmentCount: segments.length },
    };
  }
}

export const kmedoidsAgent = new KMedoidsClusterAgent();
