/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * KMeansClusterAgent — K-Means clustering via
 * CORTEX_TESTING.ML.KMEANS_CLUSTER stored procedure.
 *
 * SQL pattern — ALWAYS use CALL with a dollar-quoted input query string:
 *   CALL CORTEX_TESTING.ML.KMEANS_CLUSTER($$<input_query>$$, n_clusters)
 *
 * The procedure accepts the source SELECT as a VARCHAR parameter (dollar-quoted
 * to handle embedded single quotes) and the requested cluster count as an INT.
 * Pass 0 to let the procedure auto-detect the optimum k.
 * Results are written to CORTEX_TESTING.PUBLIC.CLUSTERING_RESULTS.
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';
import { buildClusterSegments } from './clustering-agent';

const DEFAULT_N_CLUSTERS = 5;
const DEFAULT_MAX_ITER = 300;

export class KMeansClusterAgent extends BaseAgent {
  readonly name = 'cluster-kmeans';
  readonly displayName = 'K-Means Clustering';
  readonly description =
    'K-Means clustering — partitions data into k spherical clusters using CORTEX_TESTING.ML.CLUSTER_KMEANS.';
  readonly intent: AgentIntent = 'CLUSTER_KMEANS';

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
    return `CALL CORTEX_TESTING.ML.KMeans_Cluster($$${sourceSQL.trim()}$$, ${nClusters})`;
  }

  parseResults(
    rows: Record<string, unknown>[],
    columns: string[],
    input: AgentInput,
  ): ParsedData {
    if (rows.length === 0) {
      return {
        data: { type: 'cluster', segments: [], summary: 'No clustering results returned.' },
        narrative: 'K-Means clustering returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const segments = buildClusterSegments(rows, columns);
    const nClusters = (input.extraContext?.nSegments as number | undefined) ?? DEFAULT_N_CLUSTERS;

    const narrative =
      `K-Means clustering complete (k=${nClusters}). ` +
      `${segments.length} cluster(s) identified across ${rows.length} records.`;

    return {
      data: {
        type: 'cluster',
        segments,
        summary: narrative,
        algorithm: 'CLUSTER_KMEANS',
        requestedSegments: nClusters,
        totalRecords: rows.length,
      },
      narrative,
      metadata: { rowCount: rows.length, segmentCount: segments.length },
    };
  }
}

export const kmeansAgent = new KMeansClusterAgent();
