/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * CausalValidationAgent — validates causal assumptions (parallel trends, placebo tests,
 * difference-in-differences) via CORTEX_TESTING.ML.CAUSAL_VALIDATION table-valued function.
 *
 * SQL pattern (ALWAYS use TABLE(), NEVER CALL):
 *   SELECT * FROM TABLE(CORTEX_TESTING.ML.CAUSAL_VALIDATION(
 *     CURSOR(SELECT * FROM SOURCE_DATA),
 *     outcome_col,
 *     treatment_col
 *   ))
 *
 * Output columns:
 *   TEST VARCHAR, STATISTIC FLOAT, P_VALUE FLOAT, PASSED BOOLEAN,
 *   DESCRIPTION VARCHAR, RECOMMENDATION VARCHAR
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';

export class CausalValidationAgent extends BaseAgent {
  readonly name = 'causal-validation';
  readonly displayName = 'Causal Validation';
  readonly description =
    'Validates causal assumptions (parallel trends, placebo, DiD) using CORTEX_TESTING.ML.CAUSAL_VALIDATION.';
  readonly intent: AgentIntent = 'CAUSAL_VALIDATION';

  validateInput(input: AgentInput): ValidationResult {
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return { valid: false, error: 'sourceSQL must be a non-empty SQL string.' };
    }
    const outcomeCol = input.extraContext?.outcomeCol as string | undefined;
    if (!outcomeCol) {
      return { valid: false, error: 'outcomeCol is required.' };
    }
    const treatmentCol = input.extraContext?.treatmentCol as string | undefined;
    if (!treatmentCol) {
      return { valid: false, error: 'treatmentCol is required (the binary treatment/intervention column).' };
    }
    return { valid: true };
  }

  buildSQL(input: AgentInput): string {
    const ctx = input.extraContext ?? {};
    const sourceSQL = ctx.sourceSQL as string;
    const outcomeCol = ctx.outcomeCol as string;
    const treatmentCol = ctx.treatmentCol as string;

    return [
      `WITH SOURCE_DATA AS (`,
      sourceSQL.trim(),
      `)`,
      `SELECT * FROM TABLE(CORTEX_TESTING.ML.CAUSAL_VALIDATION(`,
      `  CURSOR(SELECT * FROM SOURCE_DATA),`,
      `  '${outcomeCol}',`,
      `  '${treatmentCol}'`,
      `))`,
      `ORDER BY TEST`,
    ].join('\n');
  }

  parseResults(
    rows: Record<string, unknown>[],
    _columns: string[],
    _input: AgentInput,
  ): ParsedData {
    if (rows.length === 0) {
      return {
        data: { type: 'causal', tests: [], summary: 'No validation results returned.' },
        narrative: 'Causal validation returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const tests = rows.map((row) => ({
      test: String(row['TEST'] ?? row['test'] ?? 'Unknown'),
      statistic: toNumber(row['STATISTIC'] ?? row['statistic']),
      pValue: toNumber(row['P_VALUE'] ?? row['p_value']),
      passed: Boolean(row['PASSED'] ?? row['passed'] ?? false),
      description: String(row['DESCRIPTION'] ?? row['description'] ?? ''),
      recommendation: String(row['RECOMMENDATION'] ?? row['recommendation'] ?? ''),
    }));

    const passedCount = tests.filter((t) => t.passed).length;
    const failedCount = tests.length - passedCount;

    const narrative =
      `Causal validation complete: ${passedCount}/${tests.length} test(s) passed. ` +
      (failedCount > 0
        ? `⚠️ ${failedCount} test(s) failed — review recommendations before drawing causal conclusions.`
        : '✅ All assumption tests passed — causal conclusions are well-supported.');

    return {
      data: {
        type: 'causal',
        subtype: 'validation',
        tests,
        passedCount,
        failedCount,
        allPassed: failedCount === 0,
      },
      narrative,
      metadata: { rowCount: rows.length, passedCount, failedCount },
    };
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

export const causalValidationAgent = new CausalValidationAgent();
