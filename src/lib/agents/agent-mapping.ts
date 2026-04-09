/**
 * AGENT_ROUTING_MAP — central routing table for Blueprint v3.0.
 *
 * Maps every AgentIntent to one of three execution paths:
 *
 *   cortex_analyst — Route to the Cortex Analyst (text-to-SQL) agent via
 *                    analystAgent.execute(). Used for open-ended data
 *                    exploration and SQL generation.
 *
 *   cortex_agent   — Route to a Snowflake Named Cortex Agent that already
 *                    contains all ML orchestration, data prep, and output
 *                    formatting logic. The web app only passes the NL message
 *                    and receives a structured response.
 *
 *   pipeline       — Decompose the request into multiple ordered steps and
 *                    execute them via PipelineExecutor.
 *
 * Named agents live in CORTEX_TESTING.ML and are referenced by their
 * fully-qualified identifiers so callCortexAgent() can build the correct URL.
 */

import type { AgentIntent } from '../../types/agent';

// ---------------------------------------------------------------------------
// Route shapes
// ---------------------------------------------------------------------------

export type RoutingType = 'cortex_analyst' | 'cortex_agent' | 'pipeline';

export interface AgentRoute {
  type: RoutingType;
  /**
   * Fully-qualified Snowflake named agent identifier, e.g.
   * "CORTEX_TESTING.ML.SRI_FORECAST_AGENT".
   * Required when type === 'cortex_agent'.
   */
  cortexAgentName?: string;
  /**
   * Human-readable display name used in progress events and lineage records.
   */
  displayName: string;
}

// ---------------------------------------------------------------------------
// Named agent references
// ---------------------------------------------------------------------------

const FORECAST_AGENT = 'CORTEX_TESTING.ML.SRI_FORECAST_AGENT';
const CLUSTERING_AGENT = 'CORTEX_TESTING.ML.SRI_CLUSTERING_AGENT';
const META_TREE_AGENT = 'CORTEX_TESTING.ML.SRI_META_TREE';
const CAUSAL_AGENT = 'CORTEX_TESTING.ML.SRI_CAUSAL_INFERENCE_AGENT';

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

export const AGENT_ROUTING_MAP: Record<AgentIntent, AgentRoute> = {
  // ── Data exploration / text-to-SQL ─────────────────────────────────────
  ANALYST: {
    type: 'cortex_analyst',
    displayName: 'Cortex Analyst',
  },

  // ── Forecast (single-model) ─────────────────────────────────────────────
  FORECAST_PROPHET: {
    type: 'cortex_agent',
    cortexAgentName: FORECAST_AGENT,
    displayName: 'Prophet Forecast',
  },
  FORECAST_SARIMA: {
    type: 'cortex_agent',
    cortexAgentName: FORECAST_AGENT,
    displayName: 'SARIMA Forecast',
  },
  FORECAST_HW: {
    type: 'cortex_agent',
    cortexAgentName: FORECAST_AGENT,
    displayName: 'Holt-Winters Forecast',
  },
  FORECAST_XGB: {
    type: 'cortex_agent',
    cortexAgentName: FORECAST_AGENT,
    displayName: 'XGBoost Forecast',
  },
  FORECAST_AUTO: {
    type: 'cortex_agent',
    cortexAgentName: FORECAST_AGENT,
    displayName: 'Auto Forecast',
  },
  FORECAST_HYBRID: {
    type: 'cortex_agent',
    cortexAgentName: FORECAST_AGENT,
    displayName: 'Hybrid Forecast',
  },
  FORECAST_COMPARE: {
    type: 'cortex_agent',
    cortexAgentName: FORECAST_AGENT,
    displayName: 'Forecast Comparison',
  },

  // ── Metric tree ─────────────────────────────────────────────────────────
  MTREE: {
    type: 'cortex_agent',
    cortexAgentName: META_TREE_AGENT,
    displayName: 'Metric Tree',
  },

  // ── Clustering ──────────────────────────────────────────────────────────
  CLUSTER: {
    type: 'cortex_agent',
    cortexAgentName: CLUSTERING_AGENT,
    displayName: 'Clustering (GM)',
  },
  CLUSTER_GM: {
    type: 'cortex_agent',
    cortexAgentName: CLUSTERING_AGENT,
    displayName: 'Gaussian Mixture Clustering',
  },
  CLUSTER_DBSCAN: {
    type: 'cortex_agent',
    cortexAgentName: CLUSTERING_AGENT,
    displayName: 'DBSCAN Clustering',
  },
  CLUSTER_HIERARCHICAL: {
    type: 'cortex_agent',
    cortexAgentName: CLUSTERING_AGENT,
    displayName: 'Hierarchical Clustering',
  },
  CLUSTER_KMEANS: {
    type: 'cortex_agent',
    cortexAgentName: CLUSTERING_AGENT,
    displayName: 'K-Means Clustering',
  },
  CLUSTER_KMEDOIDS: {
    type: 'cortex_agent',
    cortexAgentName: CLUSTERING_AGENT,
    displayName: 'K-Medoids Clustering',
  },
  CLUSTER_COMPARE: {
    type: 'cortex_agent',
    cortexAgentName: CLUSTERING_AGENT,
    displayName: 'Clustering Comparison',
  },

  // ── Causal inference ────────────────────────────────────────────────────
  CAUSAL_AUTO: {
    type: 'cortex_agent',
    cortexAgentName: CAUSAL_AGENT,
    displayName: 'Causal Analysis (Auto)',
  },
  CAUSAL_CONTRIBUTION: {
    type: 'cortex_agent',
    cortexAgentName: CAUSAL_AGENT,
    displayName: 'Causal Contribution',
  },
  CAUSAL_DRIVERS: {
    type: 'cortex_agent',
    cortexAgentName: CAUSAL_AGENT,
    displayName: 'Causal Drivers',
  },
  CAUSAL_VALIDATION: {
    type: 'cortex_agent',
    cortexAgentName: CAUSAL_AGENT,
    displayName: 'Causal Validation',
  },
  CAUSAL_NARRATIVE: {
    type: 'cortex_agent',
    cortexAgentName: CAUSAL_AGENT,
    displayName: 'Causal Narrative',
  },
  CAUSAL_PIPELINE: {
    type: 'cortex_agent',
    cortexAgentName: CAUSAL_AGENT,
    displayName: 'Causal Pipeline',
  },

  // ── Multi-step pipeline ─────────────────────────────────────────────────
  PIPELINE: {
    type: 'pipeline',
    displayName: 'Multi-Step Pipeline',
  },

  // ── Fallback ────────────────────────────────────────────────────────────
  UNKNOWN: {
    type: 'cortex_analyst',
    displayName: 'Cortex Analyst',
  },
};

// ---------------------------------------------------------------------------
// Utility: build the natural-language message to send to a named Cortex Agent
// ---------------------------------------------------------------------------

/**
 * Enrich a user's NL message with context from prior pipeline step results
 * so the named agent has enough information to continue the analysis.
 *
 * @param message         Original user message
 * @param intent          The current step's intent
 * @param priorNarrative  Human-readable summary of prior steps (optional)
 * @param priorSQL        Source SQL produced by a prior ANALYST step (optional)
 * @param priorData       Structured data key-value hints from prior steps (optional)
 */
export function enrichMessage(
  message: string,
  intent: AgentIntent,
  opts: {
    priorNarrative?: string;
    priorSQL?: string;
    priorData?: Record<string, unknown>;
  } = {},
): string {
  const parts: string[] = [message];

  if (opts.priorSQL) {
    parts.push(
      `\n\n[Context — source data SQL from prior analysis step:]\n\`\`\`sql\n${opts.priorSQL}\n\`\`\``,
    );
  }

  if (opts.priorNarrative) {
    parts.push(`\n\n[Prior analysis summary:]\n${opts.priorNarrative}`);
  }

  // Intent-specific enrichment hints
  switch (intent) {
    case 'FORECAST_PROPHET':
    case 'FORECAST_SARIMA':
    case 'FORECAST_HW':
    case 'FORECAST_XGB':
    case 'FORECAST_AUTO':
    case 'FORECAST_HYBRID':
    case 'FORECAST_COMPARE':
      if (opts.priorData?.['dateCol']) {
        parts.push(`\n[Date column: ${String(opts.priorData['dateCol'])}]`);
      }
      if (opts.priorData?.['valueCol']) {
        parts.push(`[Value column: ${String(opts.priorData['valueCol'])}]`);
      }
      break;

    case 'CLUSTER':
    case 'CLUSTER_GM':
    case 'CLUSTER_DBSCAN':
    case 'CLUSTER_HIERARCHICAL':
    case 'CLUSTER_KMEANS':
    case 'CLUSTER_KMEDOIDS':
    case 'CLUSTER_COMPARE':
      if (opts.priorData?.['nClusters']) {
        parts.push(`\n[Requested clusters: ${String(opts.priorData['nClusters'])}]`);
      }
      break;

    case 'CAUSAL_CONTRIBUTION':
    case 'CAUSAL_AUTO':
      if (opts.priorData?.['baselinePeriod']) {
        parts.push(`\n[Baseline period: ${String(opts.priorData['baselinePeriod'])}]`);
      }
      if (opts.priorData?.['targetPeriod']) {
        parts.push(`[Target period: ${String(opts.priorData['targetPeriod'])}]`);
      }
      break;

    case 'CAUSAL_NARRATIVE':
      if (opts.priorData?.['drivers']) {
        parts.push(`\n[Drivers from prior step: ${JSON.stringify(opts.priorData['drivers']).slice(0, 500)}]`);
      }
      break;

    default:
      break;
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Utility: build a brief summary of an agent result for context injection
// ---------------------------------------------------------------------------

/**
 * Summarise a prior step's result into a single human-readable string.
 * Used when enriching subsequent pipeline step messages.
 */
export function summarizePriorResult(
  stepId: string,
  narrative: string | undefined,
  data: unknown,
): string {
  const parts: string[] = [`Step "${stepId}" completed.`];

  if (narrative) {
    const trimmed = narrative.slice(0, 300).trim();
    if (trimmed) parts.push(trimmed + (narrative.length > 300 ? '…' : ''));
  }

  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d['segments'])) {
      parts.push(`Produced ${(d['segments'] as unknown[]).length} cluster segment(s).`);
    } else if (Array.isArray(d['drivers'])) {
      parts.push(`Identified ${(d['drivers'] as unknown[]).length} causal driver(s).`);
    } else if (d['historical'] || d['forecast']) {
      parts.push('Produced a time-series forecast.');
    }
  }

  return parts.join(' ');
}
