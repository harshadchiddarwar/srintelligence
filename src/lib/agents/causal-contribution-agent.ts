/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * CausalContributionAgent — decomposes a metric change into driver contributions
 * via CORTEX_TESTING.ML.CAUSAL_CONTRIBUTION table-valued function.
 *
 * SQL pattern (ALWAYS use TABLE(), NEVER CALL):
 *   SELECT * FROM TABLE(CORTEX_TESTING.ML.CAUSAL_CONTRIBUTION(
 *     CURSOR(SELECT * FROM SOURCE_DATA ORDER BY period_col),
 *     target_col,
 *     period_col,
 *     baseline_period,
 *     target_period
 *   ))
 *
 * Output columns:
 *   DRIVER VARCHAR, CONTRIBUTION FLOAT, BASELINE_VALUE FLOAT,
 *   TARGET_VALUE FLOAT, ABSOLUTE_CHANGE FLOAT, RELATIVE_CHANGE FLOAT,
 *   DIRECTION VARCHAR, SIGNIFICANCE FLOAT
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';

export class CausalContributionAgent extends BaseAgent {
  readonly name = 'causal-contribution';
  readonly displayName = 'Causal Contribution Analysis';
  readonly description =
    'Decomposes a metric change into quantified driver contributions using CORTEX_TESTING.ML.CAUSAL_CONTRIBUTION.';
  readonly intent: AgentIntent = 'CAUSAL_CONTRIBUTION';

  validateInput(input: AgentInput): ValidationResult {
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return { valid: false, error: 'sourceSQL must be a non-empty SQL string.' };
    }
    const targetCol = input.extraContext?.targetCol as string | undefined;
    if (!targetCol) {
      return { valid: false, error: 'targetCol is required (the metric to decompose).' };
    }
    return { valid: true };
  }

  buildSQL(input: AgentInput): string {
    const ctx = input.extraContext ?? {};
    const sourceSQL = ctx.sourceSQL as string;
    const targetCol = ctx.targetCol as string;
    const periodCol = (ctx.periodCol as string | undefined) ?? 'PERIOD';
    const baselinePeriod = (ctx.baselinePeriod as string | undefined) ?? 'baseline';
    const targetPeriod = (ctx.targetPeriod as string | undefined) ?? 'target';

    return [
      `WITH SOURCE_DATA AS (`,
      sourceSQL.trim(),
      `)`,
      `SELECT * FROM TABLE(CORTEX_TESTING.ML.CAUSAL_CONTRIBUTION(`,
      `  CURSOR(SELECT * FROM SOURCE_DATA ORDER BY ${periodCol}),`,
      `  '${targetCol}',`,
      `  '${periodCol}',`,
      `  '${baselinePeriod}',`,
      `  '${targetPeriod}'`,
      `))`,
      `ORDER BY ABS(CONTRIBUTION) DESC`,
    ].join('\n');
  }

  parseResults(
    rows: Record<string, unknown>[],
    _columns: string[],
    _input: AgentInput,
  ): ParsedData {
    if (rows.length === 0) {
      return {
        data: { type: 'causal', drivers: [], summary: 'No contribution results returned.' },
        narrative: 'Causal contribution analysis returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const drivers = rows.map((row) => ({
      driver: String(row['DRIVER'] ?? row['driver'] ?? 'Unknown'),
      contribution: toNumber(row['CONTRIBUTION'] ?? row['contribution']) ?? 0,
      baselineValue: toNumber(row['BASELINE_VALUE'] ?? row['baseline_value']),
      targetValue: toNumber(row['TARGET_VALUE'] ?? row['target_value']),
      absoluteChange: toNumber(row['ABSOLUTE_CHANGE'] ?? row['absolute_change']),
      relativeChange: toNumber(row['RELATIVE_CHANGE'] ?? row['relative_change']),
      direction: String(row['DIRECTION'] ?? row['direction'] ?? ''),
      significance: toNumber(row['SIGNIFICANCE'] ?? row['significance']),
    }));

    const totalContrib = drivers.reduce((s, d) => s + Math.abs(d.contribution), 0);
    const topDriver = drivers[0];

    const narrative = topDriver
      ? `Causal contribution analysis complete. Top driver: "${topDriver.driver}" ` +
        `(contribution: ${topDriver.contribution >= 0 ? '+' : ''}${topDriver.contribution.toFixed(2)}). ` +
        `${drivers.length} driver(s) analysed with total explained change: ${totalContrib.toFixed(2)}.`
      : 'No significant drivers found.';

    return {
      data: { type: 'causal', subtype: 'contribution', drivers, totalContribution: totalContrib },
      narrative,
      metadata: { rowCount: rows.length, driverCount: drivers.length },
    };
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

export const causalContributionAgent = new CausalContributionAgent();
