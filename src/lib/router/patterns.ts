/**
 * Deterministic regex routing patterns for SRIntelligence.
 *
 * Patterns are sorted by priority descending.
 * Higher priority = more specific = checked first.
 */

import type { AgentIntent } from '../../types/agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoutePattern {
  pattern: RegExp;
  intent: AgentIntent;
  /** Higher number = evaluated first */
  priority: number;
  description: string;
}

// ---------------------------------------------------------------------------
// Pattern table
// ---------------------------------------------------------------------------

/**
 * All route patterns, listed in descending priority order.
 *
 * Priority 100 — Specific forecasting model keywords
 * Priority 90  — Decomposition / root-cause / clustering
 * Priority 80  — Generic forecast (catch-all for forecasting requests)
 */
export const ROUTE_PATTERNS: RoutePattern[] = [
  // -------------------------------------------------------------------------
  // Priority 110: Explicit agent/model selection via the "/" picker
  // These tags are inserted verbatim by the ChatInput agent picker and must
  // take precedence over every other pattern.
  // -------------------------------------------------------------------------
  {
    pattern: /@Analytics\b/i,
    intent: 'ANALYST',
    priority: 110,
    description: 'Explicit: Analytics agent',
  },
  {
    pattern: /@Forecast\/Prophet\b/i,
    intent: 'FORECAST_PROPHET',
    priority: 110,
    description: 'Explicit: Forecast / Prophet',
  },
  {
    pattern: /@Forecast\/SARIMA\b/i,
    intent: 'FORECAST_SARIMA',
    priority: 110,
    description: 'Explicit: Forecast / SARIMA',
  },
  {
    pattern: /@Forecast\/Holt-Winters\b/i,
    intent: 'FORECAST_HW',
    priority: 110,
    description: 'Explicit: Forecast / Holt-Winters',
  },
  {
    pattern: /@Forecast\/XGBoost\b/i,
    intent: 'FORECAST_XGB',
    priority: 110,
    description: 'Explicit: Forecast / XGBoost',
  },
  {
    pattern: /@Forecast\b/i,
    intent: 'FORECAST_AUTO',
    priority: 105,
    description: 'Explicit: Forecast (auto-select model)',
  },
  {
    pattern: /@Clustering\b/i,
    intent: 'CLUSTER',
    priority: 110,
    description: 'Explicit: Clustering agent (auto)',
  },
  {
    pattern: /@Clustering\/GMM\b/i,
    intent: 'CLUSTER_GM',
    priority: 110,
    description: 'Explicit: GMM clustering',
  },
  {
    pattern: /@Clustering\/DBSCAN\b/i,
    intent: 'CLUSTER_DBSCAN',
    priority: 110,
    description: 'Explicit: DBSCAN clustering',
  },
  {
    pattern: /@Clustering\/Hierarchical\b/i,
    intent: 'CLUSTER_HIERARCHICAL',
    priority: 110,
    description: 'Explicit: Hierarchical clustering',
  },
  {
    pattern: /@Clustering\/KMeans\b/i,
    intent: 'CLUSTER_KMEANS',
    priority: 110,
    description: 'Explicit: K-Means clustering',
  },
  {
    pattern: /@Clustering\/KMedoids\b/i,
    intent: 'CLUSTER_KMEDOIDS',
    priority: 110,
    description: 'Explicit: K-Medoids clustering',
  },
  {
    pattern: /@Clustering\/Compare\b/i,
    intent: 'CLUSTER_COMPARE',
    priority: 110,
    description: 'Explicit: Compare all clustering algorithms',
  },
  {
    pattern: /@Forecast\/Hybrid\b/i,
    intent: 'FORECAST_HYBRID',
    priority: 110,
    description: 'Explicit: Hybrid ensemble forecast',
  },
  {
    pattern: /@Causal\b/i,
    intent: 'CAUSAL_AUTO',
    priority: 110,
    description: 'Explicit: Causal inference (auto)',
  },
  {
    pattern: /@Causal\/Contribution\b/i,
    intent: 'CAUSAL_CONTRIBUTION',
    priority: 110,
    description: 'Explicit: Causal contribution analysis',
  },
  {
    pattern: /@Causal\/Drivers\b/i,
    intent: 'CAUSAL_DRIVERS',
    priority: 110,
    description: 'Explicit: Causal driver identification',
  },
  {
    pattern: /@Causal\/Validation\b/i,
    intent: 'CAUSAL_VALIDATION',
    priority: 110,
    description: 'Explicit: Causal assumption validation',
  },
  {
    pattern: /@Causal\/Narrative\b/i,
    intent: 'CAUSAL_NARRATIVE',
    priority: 110,
    description: 'Explicit: Causal narrative generation',
  },
  {
    pattern: /@Causal\/Pipeline\b/i,
    intent: 'CAUSAL_PIPELINE',
    priority: 110,
    description: 'Explicit: Full causal inference pipeline',
  },
  {
    pattern: /@mTree\b/i,
    intent: 'MTREE',
    priority: 110,
    description: 'Explicit: mTree™ agent',
  },
  {
    // Explicit natural-language mention of metric tree / mTree overrides generic patterns
    pattern: /\bm[\s-]?tree\b|\bmetric[\s-]tree\b|\buse\s+(?:metric[\s-])?tree\b/i,
    intent: 'MTREE',
    priority: 105,
    description: 'Explicit: metric tree / mTree keyword',
  },

  // -------------------------------------------------------------------------
  // Priority 100: Named forecasting models
  // -------------------------------------------------------------------------
  {
    pattern: /\bprophet\b/i,
    intent: 'FORECAST_PROPHET',
    priority: 100,
    description: 'Facebook Prophet forecasting',
  },
  {
    pattern: /\b(sarima|arima)\b/i,
    intent: 'FORECAST_SARIMA',
    priority: 100,
    description: 'SARIMA / ARIMA forecasting',
  },
  {
    pattern: /\bholt[\s-]?winters?\b/i,
    intent: 'FORECAST_HW',
    priority: 100,
    description: 'Holt-Winters exponential smoothing',
  },
  {
    pattern: /\b(xgboost|xgb|gradient[\s-]?boost(?:ing)?)\b/i,
    intent: 'FORECAST_XGB',
    priority: 100,
    description: 'XGBoost-based forecasting',
  },
  {
    pattern:
      /\b(compare\s+(?:forecast(?:ing)?|model)s?|model\s+comparison|benchmark\s+forecast(?:s|ing)?|which\s+model\s+(?:is\s+)?best)\b/i,
    intent: 'FORECAST_COMPARE',
    priority: 100,
    description: 'Compare multiple forecasting models',
  },
  {
    pattern: /\bhybrid\s+(?:forecast|model)\b|\bhybrid\b.*\bforecast\b/i,
    intent: 'FORECAST_HYBRID',
    priority: 100,
    description: 'Hybrid ensemble forecast',
  },

  // -------------------------------------------------------------------------
  // Priority 100: Named clustering algorithms
  // -------------------------------------------------------------------------
  {
    pattern: /\b(?:gaussian\s+mixture|gmm)\b/i,
    intent: 'CLUSTER_GM',
    priority: 100,
    description: 'Gaussian Mixture Model clustering',
  },
  {
    pattern: /\bdbscan\b/i,
    intent: 'CLUSTER_DBSCAN',
    priority: 100,
    description: 'DBSCAN density-based clustering',
  },
  {
    pattern: /\bhierarchical\s+cluster(?:ing)?\b|\bagglomerative\b/i,
    intent: 'CLUSTER_HIERARCHICAL',
    priority: 100,
    description: 'Hierarchical/agglomerative clustering',
  },
  {
    pattern: /\bk[\s-]?means?\b/i,
    intent: 'CLUSTER_KMEANS',
    priority: 100,
    description: 'K-Means clustering',
  },
  {
    pattern: /\bk[\s-]?medoids?\b/i,
    intent: 'CLUSTER_KMEDOIDS',
    priority: 100,
    description: 'K-Medoids clustering',
  },
  {
    pattern:
      /\b(compare\s+(?:cluster(?:ing)?|segment(?:ation)?)\s+(?:algorithm|model)s?|which\s+cluster(?:ing)?\s+(?:algorithm|method)\s+(?:is\s+)?best|cluster(?:ing)?\s+comparison)\b/i,
    intent: 'CLUSTER_COMPARE',
    priority: 100,
    description: 'Compare all clustering algorithms',
  },

  // -------------------------------------------------------------------------
  // Priority 100: Causal inference explicit method keywords
  // -------------------------------------------------------------------------
  {
    pattern: /\bcausal\s+contribution\b|\bcontribution\s+analys(?:is|e)\b/i,
    intent: 'CAUSAL_CONTRIBUTION',
    priority: 100,
    description: 'Causal contribution analysis',
  },
  {
    pattern: /\bcausal\s+driver\b|\bstatistical\s+driver\b/i,
    intent: 'CAUSAL_DRIVERS',
    priority: 100,
    description: 'Causal driver identification',
  },
  {
    // NOTE: \bDiD\b removed — case-insensitive flag makes it match the common
    // word "did", causing false positives on queries like "why did X drop".
    // The full "difference-in-difference" alternative below covers the same intent.
    pattern:
      /\bcausal\s+(?:validat|assump|test)\w*\b|\bplacebo\s+test\b|\bdifference[\s-]in[\s-]difference\b/i,
    intent: 'CAUSAL_VALIDATION',
    priority: 100,
    description: 'Causal assumption validation',
  },
  {
    pattern: /\bcausal\s+narrative\b|\bexplain\s+the\s+causal\b/i,
    intent: 'CAUSAL_NARRATIVE',
    priority: 100,
    description: 'Causal narrative generation',
  },
  {
    pattern: /\bcausal\s+pipeline\b|\brun\s+(?:full\s+)?causal\b/i,
    intent: 'CAUSAL_PIPELINE',
    priority: 100,
    description: 'Full causal inference pipeline',
  },

  // -------------------------------------------------------------------------
  // Priority 90: Root-cause / driver / metric-tree / clustering / causal
  // -------------------------------------------------------------------------
  {
    pattern: /\b(segment|cluster|group(?:ing)?|cohort|partition)\b/i,
    intent: 'CLUSTER',
    priority: 90,
    description: 'Segmentation / clustering analysis',
  },
  {
    pattern:
      /\b(why|driver|root[\s-]?cause|contributing[\s-]?factor|decompos(?:e|ition)|explain(?:ed)?\s+by|attributed?\s+to)\b/i,
    intent: 'MTREE',
    priority: 90,
    description: 'Root-cause / driver / metric-tree decomposition',
  },
  {
    pattern:
      /\b(causal(?:ity|ly)?|causal\s+(?:impact|effect|inference|analysis)|what\s+caused|causal\s+relationship)\b/i,
    intent: 'CAUSAL_AUTO',
    priority: 90,
    description: 'Causal inference analysis',
  },

  // -------------------------------------------------------------------------
  // Priority 80: Generic forecast (catch-all)
  // -------------------------------------------------------------------------
  {
    pattern:
      /\b(forecast(?:ing|s)?|predict(?:ion|ions|ed|ing)?|project(?:ion|ions|ed|ing)?|trend(?:s|ing)?|future\s+(?:sales|revenue|demand|volume|growth)|next\s+(?:week|month|quarter|year))\b/i,
    intent: 'FORECAST_AUTO',
    priority: 80,
    description: 'Generic forecast / predict (auto-select model)',
  },
];

// Ensure the exported array is sorted by priority descending (defensive sort)
ROUTE_PATTERNS.sort((a, b) => b.priority - a.priority);

// ---------------------------------------------------------------------------
// matchPatterns
// ---------------------------------------------------------------------------

export interface PatternMatch {
  intent: AgentIntent;
  pattern: RoutePattern;
}

/**
 * Test `message` against every RoutePattern and return all matches,
 * sorted by pattern priority descending.
 *
 * Returns an empty array if no pattern matches.
 */
export function matchPatterns(message: string): PatternMatch[] {
  const matches: PatternMatch[] = [];

  for (const routePattern of ROUTE_PATTERNS) {
    if (routePattern.pattern.test(message)) {
      matches.push({ intent: routePattern.intent, pattern: routePattern });
    }
    // Reset lastIndex for global-flagged regexes (defensive)
    routePattern.pattern.lastIndex = 0;
  }

  // Already sorted because ROUTE_PATTERNS is sorted, but make it explicit
  matches.sort((a, b) => b.pattern.priority - a.pattern.priority);
  return matches;
}
