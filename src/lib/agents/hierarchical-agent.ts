/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * HierarchicalClusterAgent — agglomerative hierarchical clustering via
 * CORTEX_TESTING.ML.HIERARCHICAL_CLUSTER stored procedure.
 *
 * SQL pattern — ALWAYS use CALL with a dollar-quoted input query string:
 *   CALL CORTEX_TESTING.ML.HIERARCHICAL_CLUSTER($$<input_query>$$, n_clusters)
 *
 * Pass 0 to let the procedure auto-detect the optimum cut height.
 * Results are written to CORTEX_TESTING.PUBLIC.CLUSTERING_RESULTS.
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';
import { buildClusterSegments } from './clustering-agent';

const DEFAULT_N_CLUSTERS = 5;
const DEFAULT_LINKAGE = 'ward';
const VALID_LINKAGES = new Set(['ward', 'complete', 'average', 'single']);

export class HierarchicalClusterAgent extends BaseAgent {
  readonly name = 'cluster-hierarchical';
  readonly displayName = 'Hierarchical Clustering';
  readonly description =
    'Agglomerative hierarchical clustering — builds a dendrogram bottom-up using CORTEX_TESTING.ML.CLUSTER_HIERARCHICAL.';
  readonly intent: AgentIntent = 'CLUSTER_HIERARCHICAL';

  validateInput(input: AgentInput): ValidationResult {
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return { valid: false, error: 'sourceSQL must be a non-empty SQL string.' };
    }
    const n = input.extraContext?.nSegments as number | undefined;
    if (n !== undefined && (n < 2 || n > 50)) {
      return { valid: false, error: 'nSegments must be between 2 and 50.' };
    }
    const linkage = input.extraContext?.linkage as string | undefined;
    if (linkage !== undefined && !VALID_LINKAGES.has(linkage.toLowerCase())) {
      return { valid: false, error: `linkage must be one of: ${[...VALID_LINKAGES].join(', ')}.` };
    }
    return { valid: true };
  }

  buildSQL(input: AgentInput): string {
    const sourceSQL = input.extraContext!.sourceSQL as string;
    const nClusters = (input.extraContext?.nSegments as number | undefined) ?? DEFAULT_N_CLUSTERS;

    // Procedures are called with CALL, not SELECT * FROM TABLE().
    // The input query is passed as a dollar-quoted VARCHAR; n_clusters=0 → auto-detect.
    return `CALL CORTEX_TESTING.ML.Hierarchical_cluster($$${sourceSQL.trim()}$$, ${nClusters})`;
  }

  parseResults(
    rows: Record<string, unknown>[],
    columns: string[],
    input: AgentInput,
  ): ParsedData {
    if (rows.length === 0) {
      return {
        data: { type: 'cluster', segments: [], summary: 'No clustering results returned.' },
        narrative: 'Hierarchical clustering returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const segments = buildClusterSegments(rows, columns);
    const nClusters = (input.extraContext?.nSegments as number | undefined) ?? DEFAULT_N_CLUSTERS;
    const linkage = (input.extraContext?.linkage as string | undefined) ?? DEFAULT_LINKAGE;

    const narrative =
      `Hierarchical clustering complete (n=${nClusters}, linkage=${linkage}). ` +
      `${segments.length} segment(s) identified across ${rows.length} records.`;

    return {
      data: {
        type: 'cluster',
        segments,
        summary: narrative,
        algorithm: 'CLUSTER_HIERARCHICAL',
        linkage,
        requestedSegments: nClusters,
        totalRecords: rows.length,
      },
      narrative,
      metadata: { rowCount: rows.length, segmentCount: segments.length },
    };
  }
}

export const hierarchicalAgent = new HierarchicalClusterAgent();
