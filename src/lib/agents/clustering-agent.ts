/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * ClusterGMAgent — Gaussian Mixture Model clustering via
 * CORTEX_TESTING.ML.GM_CLUSTER stored procedure.
 *
 * SQL pattern — ALWAYS use CALL with a dollar-quoted input query string:
 *   CALL CORTEX_TESTING.ML.GM_CLUSTER($$<input_query>$$, n_clusters)
 *
 * The procedure accepts the source SELECT as a VARCHAR parameter (dollar-quoted
 * to handle embedded single quotes) and the requested cluster count as an INT.
 * Pass 0 to let the procedure auto-detect the optimum k via BIC/AIC.
 * Results are written to CORTEX_TESTING.PUBLIC.CLUSTERING_RESULTS.
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_N_CLUSTERS = 5;
const MAX_N_CLUSTERS = 20;

// ---------------------------------------------------------------------------
// ClusterGMAgent
// ---------------------------------------------------------------------------

export class ClusterGMAgent extends BaseAgent {
  readonly name = 'cluster-gm';
  readonly displayName = 'GMM Clustering';
  readonly description =
    'Gaussian Mixture Model clustering — discovers probabilistic, ellipsoid-shaped segments using CORTEX_TESTING.ML.CLUSTER_GM.';
  readonly intent: AgentIntent = 'CLUSTER_GM';

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  validateInput(input: AgentInput): ValidationResult {
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return { valid: false, error: 'sourceSQL must be a non-empty SQL string.' };
    }
    const n = input.extraContext?.nSegments as number | undefined;
    if (n !== undefined && (n < 2 || n > MAX_N_CLUSTERS)) {
      return { valid: false, error: `nSegments must be between 2 and ${MAX_N_CLUSTERS}.` };
    }
    return { valid: true };
  }

  // -------------------------------------------------------------------------
  // buildSQL
  // -------------------------------------------------------------------------

  buildSQL(input: AgentInput): string {
    const sourceSQL = input.extraContext!.sourceSQL as string;
    const nClusters = (input.extraContext?.nSegments as number | undefined) ?? DEFAULT_N_CLUSTERS;

    // Procedures are called with CALL, not SELECT * FROM TABLE().
    // The input query is passed as a dollar-quoted VARCHAR; n_clusters=0 → auto-detect.
    return `CALL CORTEX_TESTING.ML.Cluster_GM($$${sourceSQL.trim()}$$, ${nClusters})`;
  }

  // -------------------------------------------------------------------------
  // parseResults
  // -------------------------------------------------------------------------

  parseResults(
    rows: Record<string, unknown>[],
    columns: string[],
    input: AgentInput,
  ): ParsedData {
    if (rows.length === 0) {
      return {
        data: { type: 'cluster', segments: [], summary: 'No clustering results returned.' },
        narrative: 'GMM clustering returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const segments = buildClusterSegments(rows, columns);
    const nClusters = (input.extraContext?.nSegments as number | undefined) ?? DEFAULT_N_CLUSTERS;

    const narrative =
      `GMM clustering complete. ${segments.length} of ${nClusters} requested segments identified ` +
      `across ${rows.length} records.`;

    return {
      data: {
        type: 'cluster',
        segments,
        summary: narrative,
        algorithm: 'CLUSTER_GM',
        requestedSegments: nClusters,
        totalRecords: rows.length,
      },
      narrative,
      metadata: { rowCount: rows.length, segmentCount: segments.length },
    };
  }
}

// ---------------------------------------------------------------------------
// Shared helpers (used by all cluster agents in this module)
// ---------------------------------------------------------------------------

export interface ClusterSegment {
  id: number;
  label: string;
  size: number;
  characteristics: string[];
  avgValues: Record<string, number>;
}

/**
 * Group rows by CLUSTER_ID and compute per-segment size + average numeric metrics.
 */
export function buildClusterSegments(
  rows: Record<string, unknown>[],
  columns: string[],
): ClusterSegment[] {
  const grouped = new Map<number, Record<string, unknown>[]>();

  for (const row of rows) {
    const clusterId = Number(row['CLUSTER_ID'] ?? row['cluster_id'] ?? 0);
    if (!grouped.has(clusterId)) grouped.set(clusterId, []);
    grouped.get(clusterId)!.push(row);
  }

  const numericCols = columns.filter(
    (c) =>
      c.toUpperCase() !== 'CLUSTER_ID' &&
      rows.some((r) => typeof r[c] === 'number' || !isNaN(Number(r[c]))),
  );

  const segments: ClusterSegment[] = [];

  for (const [clusterId, clusterRows] of grouped) {
    const size = clusterRows.length;
    const avgValues: Record<string, number> = {};

    for (const col of numericCols) {
      const values = clusterRows
        .map((r) => Number(r[col]))
        .filter((v) => !isNaN(v));
      if (values.length > 0) {
        avgValues[col] = values.reduce((s, v) => s + v, 0) / values.length;
      }
    }

    // Build characteristics: top 3 metrics by relative magnitude
    const characteristics = Object.entries(avgValues)
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
      .slice(0, 3)
      .map(([col, avg]) => `${col}: ${avg.toFixed(2)}`);

    segments.push({
      id: clusterId,
      label: `Cluster ${clusterId}`,
      size,
      characteristics,
      avgValues,
    });
  }

  return segments.sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------------------
// Singleton exports
// ---------------------------------------------------------------------------

export const clusterGMAgent = new ClusterGMAgent();

// Backward-compat alias — CLUSTER intent routes here by default
export const clusteringAgent = clusterGMAgent;
