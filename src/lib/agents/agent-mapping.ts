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
// Utility: extract the user's requested number of clusters from a message.
// Returns the integer value, or 0 if the user did not specify (meaning
// the clustering algorithm should auto-detect the optimum k).
// ---------------------------------------------------------------------------

const WORD_NUMBERS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};

export function extractNClusters(message: string): number {
  const lower = message.toLowerCase();

  // Explicit k= / n= / n_clusters= patterns (highest priority)
  const kEq = lower.match(/\bn_?clusters?\s*[=:]\s*(\d+)/);
  if (kEq) return parseInt(kEq[1], 10);

  const nEq = lower.match(/\bk\s*[=:]\s*(\d+)/);
  if (nEq) return parseInt(nEq[1], 10);

  // "N clusters / segments / groups / partitions / components" — digit before the noun
  const digitBefore = lower.match(
    /\b(\d+)\s+(?:cluster|segment|group|partition|class|cohort|component)s?\b/,
  );
  if (digitBefore) return parseInt(digitBefore[1], 10);

  // "cluster/segment/split into N" — digit after the verb phrase
  // Also covers "into N Gaussian components" — number followed by optional adjective then noun
  const digitAfter = lower.match(
    /\b(?:cluster|segment|split|divide|group|partition)\s+(?:in(?:to)?|by)\s+(\d+)\b/,
  );
  if (digitAfter) return parseInt(digitAfter[1], 10);

  // "into N <optional adjective> components" — catches GMM template phrasing
  // e.g. "into 6 Gaussian components"
  const intoComponents = lower.match(
    /\binto\s+(\d+)\s+(?:\w+\s+)?components?\b/,
  );
  if (intoComponents) return parseInt(intoComponents[1], 10);

  // Written-out numbers ("three clusters", "segment into five")
  for (const [word, num] of Object.entries(WORD_NUMBERS)) {
    const re = new RegExp(
      `\\b${word}\\s+(?:cluster|segment|group|partition|class|cohort|component)s?\\b|` +
      `\\b(?:cluster|segment|split|divide|group|partition)\\s+(?:in(?:to)?|by)\\s+${word}\\b`,
    );
    if (re.test(lower)) return num;
  }

  return 0; // auto-detect
}

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
// Shared ID-column detector — same pattern used by buildCohortClusterSQL
const COHORT_ID_PATTERNS = /key|_id$|^id_|^npi|gid|identifier|^id$/i;

export function enrichMessage(
  message: string,
  intent: AgentIntent,
  opts: {
    priorNarrative?: string;
    priorSQL?: string;
    /** Column names returned by the prior ANALYST step — used to identify the entity key. */
    priorColumns?: string[];
    priorData?: Record<string, unknown>;
    nClusters?: number; // explicit cluster count override for cluster intents
    /** Metadata from the most recent clustering run — used to inject cluster context for FORECAST. */
    clusterInfo?: {
      nClusters: number;
      recordIdCol: string | undefined;
      algorithm: string;
      runId: string;
    };
    /**
     * Per-cluster summary (label + record count) fetched from CLUSTERING_RESULTS.
     */
    clusterSummary?: Record<number, { label: string; count: number }>;
    /**
     * Per-cluster metric thresholds computed server-side by joining the prior cohort
     * SQL with CLUSTERING_RESULTS.  When present, the forecast instruction uses plain
     * "metricCol BETWEEN minVal AND maxVal" filters that Cortex Analyst CAN apply
     * (no reference to CLUSTERING_RESULTS, which is outside the semantic model).
     */
    clusterThresholds?: Record<number, {
      label: string;
      count: number;
      metricCol: string;
      minVal: number;
      maxVal: number;
    }>;
  } = {},
): string {
  const parts: string[] = [message];

  // For FORECAST intents we replace the generic SQL hint with a directive cohort
  // constraint so the agent knows it MUST scope its time-series query to the
  // identified population.  All other intents keep the generic hint.
  const isForecastIntent = /^FORECAST_/.test(intent) || intent === 'FORECAST_COMPARE' as string;

  if (opts.priorSQL && !isForecastIntent) {
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
    case 'FORECAST_COMPARE': {
      // ── Cohort constraint ───────────────────────────────────────────────────
      // If a prior analyst cohort is available, instruct the forecasting agent to
      // restrict its time-series aggregation to exactly those entities.
      // We surface both a CTE-ready SQL block AND a direct IN-list instruction
      // so the agent can choose whichever form its SQL generator supports.
      if (opts.priorSQL) {
        const idCol = opts.priorColumns?.find(c => COHORT_ID_PATTERNS.test(c))
          ?? opts.priorColumns?.[0];
        const filterInstruction = idCol
          ? `Your time-series aggregation SQL MUST include a filter restricting data to ` +
            `entities where ${idCol} is in the cohort: ` +
            `${idCol} IN (SELECT ${idCol} FROM _prior_cohort)`
          : `Your time-series aggregation SQL MUST be scoped to the entities defined ` +
            `by the cohort SQL below — do NOT query the full population.`;

        // Strip semicolons and comment footers to keep the embedded SQL clean
        const cleanSQL = opts.priorSQL
          .replace(/--[^\n]*/g, '')
          .replace(/;/g, '')
          .trim();

        parts.push(
          `\n\n[COHORT CONSTRAINT — REQUIRED: This forecast must be limited to the ` +
          `entities identified in the prior analysis step. ` +
          `${filterInstruction}. ` +
          `Define the cohort as a CTE named _prior_cohort using the SQL below:]\n` +
          `\`\`\`sql\nWITH _prior_cohort AS (\n${cleanSQL}\n)\n` +
          `SELECT ${idCol ?? '*'} FROM _prior_cohort\n\`\`\`\n` +
          `[End cohort constraint]`,
        );
      }
      if (opts.priorData?.['dateCol']) {
        parts.push(`\n[Date column: ${String(opts.priorData['dateCol'])}]`);
      }
      if (opts.priorData?.['valueCol']) {
        parts.push(`[Value column: ${String(opts.priorData['valueCol'])}]`);
      }

      // ── Per-cluster forecast instruction ──────────────────────────────────
      // Strategy A (preferred): Use server-computed metric thresholds so the
      // agent can filter via plain SQL (BETWEEN X AND Y) — no CLUSTERING_RESULTS
      // reference needed, which Cortex Analyst cannot resolve.
      // Strategy B (fallback): Surface cluster context only; agent will produce
      // a single aggregate forecast with a note about the clusters.
      if (opts.clusterThresholds && Object.keys(opts.clusterThresholds).length >= 2) {
        const { clusterThresholds } = opts;
        const algorithm = opts.clusterInfo?.algorithm ?? 'clustering';
        const nClusters = Object.keys(clusterThresholds).length;

        const clusterLines = Object.entries(clusterThresholds)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([cidStr, { label, count, metricCol, minVal, maxVal }]) =>
            `  Cluster ${cidStr} — ${label} (${count} records):\n` +
            `    SQL filter: ${metricCol} BETWEEN ${Math.floor(minVal)} AND ${Math.ceil(maxVal)}`,
          )
          .join('\n');

        parts.push(
          `\n\n[CLUSTER FORECAST INSTRUCTION — REQUIRED:\n` +
          `The cohort was segmented into ${nClusters} groups via ${algorithm} clustering.\n` +
          `Use the metric filters below to split the cohort — do NOT reference CLUSTERING_RESULTS:\n\n` +
          `${clusterLines}\n\n` +
          `Apply the metric filter shown above when building the time-series SQL for each cluster.\n` +
          `You MUST produce a SEPARATE 13-week forecast for EACH cluster.\n` +
          `For EACH cluster output a section header "### Cluster <N> — <LABEL>" followed by:\n` +
          `  1. A validation table: Week | Actual Claims | Predicted Claims | Error %\n` +
          `  2. A forecast table:   Week | Predicted Claims | 80% CI Lower | 80% CI Upper\n` +
          `Do NOT combine clusters into a single aggregate forecast.]`,
        );
      } else if (opts.clusterInfo) {
        // Fallback: no thresholds available — surface cluster context only
        const { nClusters, algorithm } = opts.clusterInfo;
        const summaryLines = opts.clusterSummary
          ? Object.entries(opts.clusterSummary)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([cid, { label, count }]) => `  Cluster ${cid} — ${label} (${count} records)`)
              .join('\n')
          : Array.from({ length: nClusters }, (_, i) => `  Cluster ${i}`).join('\n');
        parts.push(
          `\n\n[Context: The cohort was previously segmented into ${nClusters} clusters via ${algorithm}:\n` +
          `${summaryLines}\n` +
          `Generate a separate 13-week forecast for each cluster where possible.]`,
        );
      }
      break;
    }

    // CLUSTER* intents are handled directly by route-dispatcher (Option B):
    // Cortex Analyst → UDTF SELECT...TABLE()...OVER() → executeSQL() → persist.
    // SRI_CLUSTERING_AGENT is NOT called for CLUSTER* intents, so no enrichment
    // instructions are injected here.
    case 'CLUSTER':
    case 'CLUSTER_GM':
    case 'CLUSTER_DBSCAN':
    case 'CLUSTER_HIERARCHICAL':
    case 'CLUSTER_KMEANS':
    case 'CLUSTER_KMEDOIDS':
    case 'CLUSTER_COMPARE':
      break;

    case 'CAUSAL_CONTRIBUTION':
    case 'CAUSAL_AUTO':
    case 'CAUSAL_DRIVERS':
    case 'CAUSAL_PIPELINE': {
      if (opts.priorData?.['baselinePeriod']) {
        parts.push(`\n[Baseline period: ${String(opts.priorData['baselinePeriod'])}]`);
      }
      if (opts.priorData?.['targetPeriod']) {
        parts.push(`[Target period: ${String(opts.priorData['targetPeriod'])}]`);
      }

      // ── Cluster context injection ─────────────────────────────────────────
      // CLUSTERING_RESULTS is in the Snowflake semantic model (with a
      // relationship to physician_ref via RECORD_ID = physician_key), so the
      // CI agent's internal Cortex Analyst can resolve the subquery filter
      // natively.  We inject the segment → label + SQL-filter mapping so the
      // agent knows the exact CLUSTER_ID value and record counts.
      if (opts.clusterInfo) {
        const { nClusters, algorithm, recordIdCol } = opts.clusterInfo;
        const entityDesc = recordIdCol
          ? `${recordIdCol.replace(/_key$|_id$|_gid$/i, '').replace(/_/g, ' ')}s`
          : 'records';

        // Build per-segment listing, preferring threshold data (has metric ranges)
        // then summary (has labels/counts), then a plain ordinal fallback.
        const sourceMap: Record<string, { label: string; count: number }> | undefined =
          (opts.clusterThresholds ?? opts.clusterSummary) as Record<string, { label: string; count: number }> | undefined;

        // Scope SQL filters to the specific run so physician counts are exact.
        // Without RUN_ID the IN-subquery spans all historical runs, returning
        // tens of thousands of IDs instead of the actual ~192 in this run.
        const runIdFilter = opts.clusterInfo.runId && opts.clusterInfo.runId !== 'unknown'
          ? ` AND RUN_ID = '${opts.clusterInfo.runId}'`
          : '';

        const segmentLines = sourceMap && Object.keys(sourceMap).length >= 1
          ? Object.entries(sourceMap)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([cidStr, v]) => {
                const filter = recordIdCol
                  ? `${recordIdCol} IN (SELECT RECORD_ID FROM CORTEX_TESTING.PUBLIC.CLUSTERING_RESULTS WHERE CLUSTER_ID = ${cidStr}${runIdFilter})`
                  : `RECORD_ID IN (SELECT RECORD_ID FROM CORTEX_TESTING.PUBLIC.CLUSTERING_RESULTS WHERE CLUSTER_ID = ${cidStr}${runIdFilter})`;
                return (
                  `  Segment ${cidStr} = Cluster ${cidStr} — ${v.label} (${v.count} ${entityDesc}):\n` +
                  `    SQL filter: ${filter}`
                );
              })
              .join('\n')
          : Array.from({ length: nClusters }, (_, i) => {
              const filter = recordIdCol
                ? `${recordIdCol} IN (SELECT RECORD_ID FROM CORTEX_TESTING.PUBLIC.CLUSTERING_RESULTS WHERE CLUSTER_ID = ${i}${runIdFilter})`
                : `RECORD_ID IN (SELECT RECORD_ID FROM CORTEX_TESTING.PUBLIC.CLUSTERING_RESULTS WHERE CLUSTER_ID = ${i}${runIdFilter})`;
              return `  Segment ${i} = Cluster ${i}:\n    SQL filter: ${filter}`;
            }).join('\n');

        parts.push(
          `\n\n[CLUSTER CONTEXT — REQUIRED:\n` +
          `The cohort was previously segmented into ${nClusters} groups via ${algorithm} clustering by ${entityDesc}.\n` +
          `When the user refers to "segment N", "cluster N", or "group N", resolve it using the mapping below.\n` +
          `CLUSTERING_RESULTS is in CORTEX_TESTING.PUBLIC (columns: RECORD_ID VARCHAR, CLUSTER_ID INT, CLUSTER_LABEL VARCHAR).\n\n` +
          `${segmentLines}\n\n` +
          `Use the SQL filter shown above to scope the causal analysis to the requested segment.\n` +
          `If no specific segment is requested, run the analysis on the full clustered population.\n` +
          `]`,
        );

        // ── Competitive Flow table format requirement ──────────────────────────
        // The web renderer (CausalNarrativeReport) needs a "### Competitive Flow"
        // section with H1/H2 market share per brand to anchor the W2 waterfall
        // chart (showing Brand7's collapse from H1 share → H2 share).
        // Without this table, W2 falls back to a proportional display that
        // cannot show Brand7's absolute share values on the Y-axis.
        parts.push(
          `\n\n[REPORT FORMAT REQUIREMENT — REQUIRED:\n` +
          `Your output MUST include a section titled EXACTLY "### Competitive Flow" containing a markdown table with these columns:\n` +
          `  Brand | H1 Share | H2 Share | Change\n` +
          `List EVERY brand in the data (BRAND1, BRAND7, BRAND8, etc.) with their H1 market share (%), H2 market share (%), and pp change.\n` +
          `This table is mandatory — without it the W2 waterfall chart cannot render the competitor's share movement correctly.\n` +
          `]`,
        );
      }
      break;
    }

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
