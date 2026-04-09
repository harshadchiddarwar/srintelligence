/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * HWAgent — Holt-Winters exponential smoothing via CORTEX_TESTING.ML.HW_CALCULATE UDTF.
 *
 * Holt-Winters (triple exponential smoothing) is well-suited for series with
 * level, trend, and seasonal components. Structure mirrors ProphetAgent and
 * SarimaAgent.
 *
 * Expected UDTF output columns: DS, YHAT (and optionally YHAT_LOWER, YHAT_UPPER).
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';
import { normalizeForecastResults } from './forecast-normalize';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HORIZON = 13;
const DEFAULT_HISTORY_MONTHS = 24;
const DEFAULT_DATE_COL = 'WEEK_DATE';
const DEFAULT_VALUE_COL = 'METRIC_VALUE';

// ---------------------------------------------------------------------------
// HWAgent
// ---------------------------------------------------------------------------

export class HWAgent extends BaseAgent {
  readonly name = 'holt-winters';
  readonly displayName = 'Holt-Winters Forecast';
  readonly description =
    'Holt-Winters triple exponential smoothing; models level, trend, and seasonal components.';
  readonly intent: AgentIntent = 'FORECAST_HW';

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  validateInput(input: AgentInput): ValidationResult {
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return { valid: false, error: 'sourceSQL must be a non-empty SQL string.' };
    }
    const horizon = input.extraContext?.horizon as number | undefined;
    if (horizon !== undefined && (typeof horizon !== 'number' || horizon < 1 || horizon > 104)) {
      return { valid: false, error: 'horizon must be a positive integer between 1 and 104.' };
    }
    return { valid: true };
  }

  // -------------------------------------------------------------------------
  // buildSQL
  // -------------------------------------------------------------------------

  buildSQL(input: AgentInput): string {
    const ctx = input.extraContext ?? {};
    const sourceSQL = ctx.sourceSQL as string;
    const horizon = (ctx.horizon as number | undefined) ?? DEFAULT_HORIZON;
    const historyMonths = (ctx.historyMonths as number | undefined) ?? DEFAULT_HISTORY_MONTHS;
    const dateCol = (ctx.dateCol as string | undefined) ?? DEFAULT_DATE_COL;
    const valueCol = (ctx.valueCol as string | undefined) ?? DEFAULT_VALUE_COL;

    return (
      `WITH SOURCE_DATA AS (\n${sourceSQL}\n)\n` +
      `SELECT * FROM TABLE(CORTEX_TESTING.ML.HW_CALCULATE(\n` +
      `  CURSOR(SELECT "${dateCol}", "${valueCol}" FROM SOURCE_DATA ORDER BY "${dateCol}"),\n` +
      `  ${horizon},\n` +
      `  ${historyMonths}\n` +
      `)) ORDER BY DS`
    );
  }

  // -------------------------------------------------------------------------
  // parseResults
  // -------------------------------------------------------------------------

  parseResults(
    rows: Record<string, unknown>[],
    _columns: string[],
    input: AgentInput,
  ): ParsedData {
    const horizon = (input.extraContext?.horizon as number | undefined) ?? DEFAULT_HORIZON;

    const data = normalizeForecastResults({
      allRows: rows,
      horizon,
      modelName: 'Holt-Winters',
      modelNotes: [
        'Holt-Winters triple exponential smoothing models level, trend, and seasonality independently.',
        'Smoothing parameters (α, β, γ) are optimised by minimising sum-of-squared errors on the training window.',
        'This model excels at series with stable, repeating seasonal patterns and gradual trend shifts.',
      ],
    });

    return {
      data,
      narrative: data.summary,
      metadata: {
        horizon,
        historicalCount: data.historical.length,
        forecastCount: data.forecast.length,
        totalRows: rows.length,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const hwAgent = new HWAgent();
