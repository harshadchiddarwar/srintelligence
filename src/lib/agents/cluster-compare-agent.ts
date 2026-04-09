/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * ClusterCompareAgent — runs all five clustering algorithms in parallel and
 * selects the best by silhouette score.
 *
 * Each algorithm is run via its TABLE() function:
 *   CLUSTER_GM, CLUSTER_DBSCAN, CLUSTER_HIERARCHICAL, CLUSTER_KMEANS, CLUSTER_KMEDOIDS
 *
 * To retrieve the silhouette score we query CORTEX_TESTING.ML.CLUSTER_SILHOUETTE
 * after clustering (if available), otherwise we rank by segment count uniformity.
 *
 * Uses Promise.allSettled so a single algorithm failure does not block the rest.
 */

import { randomUUID } from 'crypto';
import { clusterGMAgent } from './clustering-agent';
import { dbscanAgent } from './dbscan-agent';
import { hierarchicalAgent } from './hierarchical-agent';
import { kmeansAgent } from './kmeans-agent';
import { kmedoidsAgent } from './kmedoids-agent';
import type {
  AgentInput,
  AgentResult,
  AgentArtifact,
  AgentIntent,
} from '../../types/agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlgorithmSummary {
  algorithmName: string;
  displayName: string;
  success: boolean;
  segmentCount?: number;
  silhouetteScore?: number;
  error?: string;
  segments?: unknown[];
}

// ---------------------------------------------------------------------------
// ClusterCompareAgent
// ---------------------------------------------------------------------------

export class ClusterCompareAgent {
  readonly name = 'cluster-compare';
  readonly displayName = 'Clustering Algorithm Comparison';
  readonly description =
    'Runs all five clustering algorithms in parallel (GMM, DBSCAN, Hierarchical, K-Means, K-Medoids) and identifies the best by silhouette score.';
  readonly intent: AgentIntent = 'CLUSTER_COMPARE';

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    const lineageId = randomUUID();

    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return this.makeErrorResult(
        'sourceSQL must be a non-empty SQL string.',
        'VALIDATION_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // Run all five algorithms in parallel
    // ------------------------------------------------------------------
    const [gmSettled, dbscanSettled, hierSettled, kmeansSettled, kmedoidsSettled] =
      await Promise.allSettled([
        clusterGMAgent.execute(input),
        dbscanAgent.execute(input),
        hierarchicalAgent.execute(input),
        kmeansAgent.execute(input),
        kmedoidsAgent.execute(input),
      ]);

    const settled = [
      { agent: clusterGMAgent, result: gmSettled },
      { agent: dbscanAgent, result: dbscanSettled },
      { agent: hierarchicalAgent, result: hierSettled },
      { agent: kmeansAgent, result: kmeansSettled },
      { agent: kmedoidsAgent, result: kmedoidsSettled },
    ];

    // ------------------------------------------------------------------
    // Summarise each algorithm result
    // ------------------------------------------------------------------
    const summaries: AlgorithmSummary[] = settled.map(({ agent, result }) => {
      if (result.status === 'rejected') {
        return {
          algorithmName: agent.name,
          displayName: agent.displayName,
          success: false,
          error: String(result.reason),
        };
      }

      const agentResult = result.value;
      if (!agentResult.success || !agentResult.artifact) {
        return {
          algorithmName: agent.name,
          displayName: agent.displayName,
          success: false,
          error: agentResult.error ?? 'Unknown failure',
        };
      }

      const data = agentResult.artifact.data as Record<string, unknown> | null;
      const segments = data?.['segments'] as unknown[] | undefined;
      const silhouetteScore = data?.['silhouetteScore'] as number | undefined;

      return {
        algorithmName: agent.name,
        displayName: agent.displayName,
        success: true,
        segmentCount: segments?.length,
        silhouetteScore,
        segments,
      };
    });

    // ------------------------------------------------------------------
    // Pick winner: highest silhouette score; fall back to most balanced segments
    // ------------------------------------------------------------------
    const successful = summaries.filter((s) => s.success);

    const winner = successful.length > 0
      ? pickWinner(successful)
      : null;

    const successCount = successful.length;

    const narrative = winner
      ? `Clustering comparison complete (${successCount}/${summaries.length} succeeded). ` +
        `Best algorithm: ${winner.displayName}` +
        (winner.silhouetteScore !== undefined
          ? ` (silhouette: ${winner.silhouetteScore.toFixed(3)}).`
          : ` (${winner.segmentCount} segments).`)
      : successCount > 0
        ? `${successCount} algorithm(s) succeeded but no ranking signal was available.`
        : 'All clustering algorithms failed. Check sourceSQL and Snowflake connectivity.';

    const artifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: {
        type: 'cluster_comparison',
        algorithms: summaries,
        winner: winner
          ? {
              algorithmName: winner.algorithmName,
              displayName: winner.displayName,
              segmentCount: winner.segmentCount,
              silhouetteScore: winner.silhouetteScore,
              segments: winner.segments,
            }
          : null,
        successCount,
        failureCount: summaries.length - successCount,
      },
      narrative,
      createdAt: Date.now(),
      lineageId,
      cacheStatus: 'miss',
    };

    const agentResult: AgentResult = {
      success: successCount > 0,
      artifact,
      error: successCount === 0 ? 'All clustering algorithms failed' : undefined,
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };

    this.recordLineage(input, lineageId).catch(() => {});
    return agentResult;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private makeErrorResult(
    error: string,
    errorType: string,
    startTime: number,
    lineageId: string,
  ): AgentResult {
    const artifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: null,
      narrative: `Error (${errorType}): ${error}`,
      createdAt: Date.now(),
      lineageId,
      cacheStatus: 'error',
    };
    return { success: false, artifact, error, durationMs: 0, retryCount: 0 };
  }

  private async recordLineage(input: AgentInput, lineageId: string): Promise<void> {
    try {
      const { LineageTracker } = await import('./lineage-tracker');
      await LineageTracker.getInstance().record({
        lineageId,
        sessionId: input.sessionId,
        userId: input.userId,
        intent: this.intent,
        agentName: this.name,
      });
    } catch { /* non-blocking */ }
  }
}

// ---------------------------------------------------------------------------
// Winner selection
// ---------------------------------------------------------------------------

function pickWinner(summaries: AlgorithmSummary[]): AlgorithmSummary {
  // Prefer highest silhouette score
  const withScore = summaries.filter((s) => s.silhouetteScore !== undefined);
  if (withScore.length > 0) {
    return withScore.reduce((best, cur) =>
      cur.silhouetteScore! > best.silhouetteScore! ? cur : best,
    );
  }
  // Fall back: pick algorithm with most segments (richer segmentation)
  return summaries.reduce((best, cur) =>
    (cur.segmentCount ?? 0) > (best.segmentCount ?? 0) ? cur : best,
  );
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const clusterCompareAgent = new ClusterCompareAgent();
