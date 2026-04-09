/**
 * CostEstimator — heuristic pre-execution cost estimation per agent intent.
 * No external calls are made; estimates are based on known Snowflake credit
 * consumption patterns for each agent type.
 */

import type { AgentIntent } from '../../types/agent';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ComplexityLevel = 'low' | 'medium' | 'high';

export interface CostEstimate {
  /** Snowflake credits (compute) */
  credits: number;
  /** Snowflake warehouse fractional credits */
  warehouseCredits: number;
  /** Expected wall-clock duration in milliseconds */
  estimatedDurationMs: number;
  complexity: ComplexityLevel;
  intent: AgentIntent;
}

export interface BudgetCheck {
  approved: boolean;
  /** Present when not approved or when approaching the soft limit */
  reason?: string;
  /** True when within the soft limit zone (80–100 % of remaining budget) */
  isSoftWarning?: boolean;
}

// ---------------------------------------------------------------------------
// Per-intent base estimates
// ---------------------------------------------------------------------------

interface BaseEstimate {
  credits: number;
  warehouseCredits: number;
  estimatedDurationMs: number;
  complexity: ComplexityLevel;
}

const BASE_ESTIMATES: Record<AgentIntent, BaseEstimate> = {
  ANALYST: {
    credits: 0.42,
    warehouseCredits: 0.01,
    estimatedDurationMs: 5_000,
    complexity: 'low',
  },
  FORECAST_PROPHET: {
    credits: 0.47,
    warehouseCredits: 0.02,
    estimatedDurationMs: 15_000,
    complexity: 'medium',
  },
  FORECAST_SARIMA: {
    credits: 0.47,
    warehouseCredits: 0.02,
    estimatedDurationMs: 15_000,
    complexity: 'medium',
  },
  FORECAST_HW: {
    credits: 0.47,
    warehouseCredits: 0.02,
    estimatedDurationMs: 15_000,
    complexity: 'medium',
  },
  FORECAST_XGB: {
    credits: 0.47,
    warehouseCredits: 0.02,
    estimatedDurationMs: 15_000,
    complexity: 'medium',
  },
  FORECAST_AUTO: {
    credits: 0.47,
    warehouseCredits: 0.02,
    estimatedDurationMs: 15_000,
    complexity: 'medium',
  },
  FORECAST_COMPARE: {
    credits: 0.62,
    warehouseCredits: 0.04,
    estimatedDurationMs: 45_000,
    complexity: 'high',
  },
  MTREE: {
    credits: 0.47,
    warehouseCredits: 0.02,
    estimatedDurationMs: 20_000,
    complexity: 'medium',
  },
  FORECAST_HYBRID: {
    credits: 0.55,
    warehouseCredits: 0.03,
    estimatedDurationMs: 30_000,
    complexity: 'medium',
  },
  CLUSTER: {
    credits: 0.52,
    warehouseCredits: 0.03,
    estimatedDurationMs: 25_000,
    complexity: 'medium',
  },
  CLUSTER_GM: {
    credits: 0.52,
    warehouseCredits: 0.03,
    estimatedDurationMs: 25_000,
    complexity: 'medium',
  },
  CLUSTER_DBSCAN: {
    credits: 0.52,
    warehouseCredits: 0.03,
    estimatedDurationMs: 25_000,
    complexity: 'medium',
  },
  CLUSTER_HIERARCHICAL: {
    credits: 0.55,
    warehouseCredits: 0.03,
    estimatedDurationMs: 30_000,
    complexity: 'medium',
  },
  CLUSTER_KMEANS: {
    credits: 0.50,
    warehouseCredits: 0.03,
    estimatedDurationMs: 20_000,
    complexity: 'medium',
  },
  CLUSTER_KMEDOIDS: {
    credits: 0.52,
    warehouseCredits: 0.03,
    estimatedDurationMs: 25_000,
    complexity: 'medium',
  },
  CLUSTER_COMPARE: {
    credits: 0.80,
    warehouseCredits: 0.08,
    estimatedDurationMs: 90_000,
    complexity: 'high',
  },
  CAUSAL_AUTO: {
    credits: 0.60,
    warehouseCredits: 0.04,
    estimatedDurationMs: 30_000,
    complexity: 'high',
  },
  CAUSAL_CONTRIBUTION: {
    credits: 0.58,
    warehouseCredits: 0.04,
    estimatedDurationMs: 25_000,
    complexity: 'high',
  },
  CAUSAL_DRIVERS: {
    credits: 0.58,
    warehouseCredits: 0.04,
    estimatedDurationMs: 25_000,
    complexity: 'high',
  },
  CAUSAL_VALIDATION: {
    credits: 0.55,
    warehouseCredits: 0.03,
    estimatedDurationMs: 20_000,
    complexity: 'medium',
  },
  CAUSAL_NARRATIVE: {
    credits: 0.50,
    warehouseCredits: 0.02,
    estimatedDurationMs: 15_000,
    complexity: 'medium',
  },
  CAUSAL_PIPELINE: {
    credits: 0.90,
    warehouseCredits: 0.08,
    estimatedDurationMs: 120_000,
    complexity: 'high',
  },
  PIPELINE: {
    credits: 0.0, // computed dynamically below
    warehouseCredits: 0.0,
    estimatedDurationMs: 0,
    complexity: 'high',
  },
  UNKNOWN: {
    credits: 0.42,
    warehouseCredits: 0.01,
    estimatedDurationMs: 5_000,
    complexity: 'low',
  },
};

// Single-step intents that compose a PIPELINE
const PIPELINE_STEP_INTENTS: AgentIntent[] = [
  'ANALYST',
  'FORECAST_PROPHET',
  'MTREE',
  'CLUSTER',
];

// ---------------------------------------------------------------------------
// CostEstimator
// ---------------------------------------------------------------------------

export class CostEstimator {
  /**
   * Returns a heuristic CostEstimate for the given intent.
   * For PIPELINE, sums the estimates for a typical multi-step run.
   */
  estimate(
    intent: AgentIntent,
    sourceSQL: string,
    parameters: Record<string, unknown>,
  ): CostEstimate {
    if (intent === 'PIPELINE') {
      return this.estimatePipeline(sourceSQL, parameters);
    }

    const base = BASE_ESTIMATES[intent];
    return { ...base, intent };
  }

  private estimatePipeline(
    _sourceSQL: string,
    _parameters: Record<string, unknown>,
  ): CostEstimate {
    let totalCredits = 0;
    let totalWarehouse = 0;
    let totalDuration = 0;

    for (const stepIntent of PIPELINE_STEP_INTENTS) {
      const base = BASE_ESTIMATES[stepIntent];
      totalCredits += base.credits;
      totalWarehouse += base.warehouseCredits;
      totalDuration += base.estimatedDurationMs;
    }

    return {
      credits: totalCredits,
      warehouseCredits: totalWarehouse,
      estimatedDurationMs: totalDuration,
      complexity: 'high',
      intent: 'PIPELINE',
    };
  }

  // ---------------------------------------------------------------------------
  // Budget guard
  // ---------------------------------------------------------------------------

  /**
   * Checks whether the estimated cost fits within the user's remaining credit budget.
   *
   * - Hard limit: cost > remainingCredits → rejected.
   * - Soft limit: cost > 80 % of remainingCredits → approved with warning.
   */
  checkBudget(
    _userId: string,
    estimate: CostEstimate,
    remainingCredits: number,
  ): BudgetCheck {
    if (estimate.credits > remainingCredits) {
      return {
        approved: false,
        reason: `Estimated cost (${estimate.credits.toFixed(2)} credits) exceeds your remaining daily budget (${remainingCredits.toFixed(2)} credits).`,
      };
    }

    const softThreshold = remainingCredits * 0.8;
    if (estimate.credits > softThreshold) {
      return {
        approved: true,
        isSoftWarning: true,
        reason: `Warning: this query will consume ${estimate.credits.toFixed(2)} of your remaining ${remainingCredits.toFixed(2)} credits (>${(80).toFixed(0)}% of budget).`,
      };
    }

    return { approved: true };
  }
}

export const costEstimator = new CostEstimator();
