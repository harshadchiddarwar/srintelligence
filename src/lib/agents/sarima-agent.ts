/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * SarimaAgent — SARIMA time-series forecasting via CORTEX_TESTING.ML.SARIMA_CALCULATE UDTF.
 *
 * SARIMA (Seasonal ARIMA) is suited for series with strong periodic patterns.
 * Structure mirrors ProphetAgent; only the UDTF name and display metadata differ.
 *
 * Expected UDTF output columns: DS, YHAT (and optionally YHAT_LOWER, YHAT_UPPER, RESIDUAL).
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
// SarimaAgent
// ---------------------------------------------------------------------------

export class SarimaAgent extends BaseAgent {
  readonly name = 'sarima';
  readonly displayName = 'SARIMA Forecast';
  readonly description =
    'Seasonal ARIMA forecasting model; well-suited for time series with strong periodic patterns.';
  readonly intent: AgentIntent = 'FORECAST_SARIMA';

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
      `SELECT * FROM TABLE(CORTEX_TESTING.ML.SARIMA_CALCULATE(\n` +
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
      modelName: 'SARIMA',
      modelNotes: [
        'SARIMA (Seasonal ARIMA) captures autoregressive and moving-average patterns along with seasonal cycles.',
        'Order parameters (p, d, q) and seasonal order are automatically selected via AIC minimisation.',
        'Confidence intervals are derived analytically from the fitted ARMA variance.',
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
// Singleton export
// ---------------------------------------------------------------------------

export const sarimaAgent = new SarimaAgent();
