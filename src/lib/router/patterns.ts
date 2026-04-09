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

  // -------------------------------------------------------------------------
  // Priority 90: Root-cause / driver / metric-tree / clustering
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
