/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * CausalDriverAgent — identifies statistically significant causal drivers via
 * CORTEX_TESTING.ML.CAUSAL_DRIVERS table-valued function.
 *
 * SQL pattern (ALWAYS use TABLE(), NEVER CALL):
 *   SELECT * FROM TABLE(CORTEX_TESTING.ML.CAUSAL_DRIVERS(
 *     CURSOR(SELECT * FROM SOURCE_DATA),
 *     outcome_col
 *   ))
 *
 * Output columns:
 *   DRIVER VARCHAR, IMPORTANCE FLOAT, DIRECTION VARCHAR,
 *   EFFECT FLOAT, P_VALUE FLOAT, SIGNIFICANT BOOLEAN
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';

export class CausalDriverAgent extends BaseAgent {
  readonly name = 'causal-drivers';
  readonly displayName = 'Causal Driver Analysis';
  readonly description =
    'Identifies statistically significant causal drivers of a target metric using CORTEX_TESTING.ML.CAUSAL_DRIVERS.';
  readonly intent: AgentIntent = 'CAUSAL_DRIVERS';

  validateInput(input: AgentInput): ValidationResult {
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return { valid: false, error: 'sourceSQL must be a non-empty SQL string.' };
    }
    const outcomeCol = input.extraContext?.outcomeCol as string | undefined;
    if (!outcomeCol) {
      return { valid: false, error: 'outcomeCol is required (the target/outcome variable).' };
    }
    return { valid: true };
  }

  buildSQL(input: AgentInput): string {
    const ctx = input.extraContext ?? {};
    const sourceSQL = ctx.sourceSQL as string;
    const outcomeCol = ctx.outcomeCol as string;

    return [
      `WITH SOURCE_DATA AS (`,
      sourceSQL.trim(),
      `)`,
      `SELECT * FROM TABLE(CORTEX_TESTING.ML.CAUSAL_DRIVERS(`,
      `  CURSOR(SELECT * FROM SOURCE_DATA),`,
      `  '${outcomeCol}'`,
      `))`,
      `ORDER BY IMPORTANCE DESC`,
    ].join('\n');
  }

  parseResults(
    rows: Record<string, unknown>[],
    _columns: string[],
    _input: AgentInput,
  ): ParsedData {
    if (rows.length === 0) {
      return {
        data: { type: 'causal', drivers: [], summary: 'No driver results returned.' },
        narrative: 'Causal driver analysis returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const drivers = rows.map((row) => ({
      driver: String(row['DRIVER'] ?? row['driver'] ?? 'Unknown'),
      importance: toNumber(row['IMPORTANCE'] ?? row['importance']) ?? 0,
      direction: String(row['DIRECTION'] ?? row['direction'] ?? ''),
      effect: toNumber(row['EFFECT'] ?? row['effect']),
      pValue: toNumber(row['P_VALUE'] ?? row['p_value']),
      significant: Boolean(row['SIGNIFICANT'] ?? row['significant'] ?? false),
    }));

    const sigDrivers = drivers.filter((d) => d.significant);
    const topDriver = drivers[0];

    const narrative = topDriver
      ? `Causal driver analysis complete. ${sigDrivers.length} significant driver(s) found. ` +
        `Top driver: "${topDriver.driver}" (importance: ${topDriver.importance.toFixed(3)}, ` +
        `direction: ${topDriver.direction || 'N/A'}).`
      : 'No significant causal drivers found.';

    return {
      data: {
        type: 'causal',
        subtype: 'drivers',
        drivers,
        significantCount: sigDrivers.length,
      },
      narrative,
      metadata: { rowCount: rows.length, driverCount: drivers.length, significantCount: sigDrivers.length },
    };
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

export const causalDriverAgent = new CausalDriverAgent();
