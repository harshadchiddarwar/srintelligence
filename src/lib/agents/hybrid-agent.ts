/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * HybridForecastAgent — ensemble hybrid forecasting via
 * CORTEX_TESTING.ML.FORECAST_HYBRID table-valued function (UDTF).
 *
 * SQL pattern (ALWAYS use TABLE() with OVER (ORDER BY), NEVER CALL):
 *   SELECT * FROM TABLE(CORTEX_TESTING.ML.FORECAST_HYBRID(
 *     CURSOR(SELECT date_col, value_col FROM SOURCE_DATA ORDER BY date_col),
 *     horizon,
 *     history_months
 *   )) ORDER BY DS
 *
 * The UDTF combines multiple forecasting models (Prophet, SARIMA, XGBoost)
 * into a single ensemble output with weighted averaging.
 *
 * Output columns: DS, YHAT, YHAT_LOWER, YHAT_UPPER, MODEL_WEIGHTS (JSON)
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';
import { normalizeForecastResults } from './forecast-normalize';

const DEFAULT_HORIZON = 13;
const DEFAULT_HISTORY_MONTHS = 24;
const DEFAULT_DATE_COL = 'WEEK_DATE';
const DEFAULT_VALUE_COL = 'METRIC_VALUE';

export class HybridForecastAgent extends BaseAgent {
  readonly name = 'forecast-hybrid';
  readonly displayName = 'Hybrid Ensemble Forecast';
  readonly description =
    'Ensemble hybrid forecasting — combines Prophet, SARIMA, and XGBoost predictions using CORTEX_TESTING.ML.FORECAST_HYBRID.';
  readonly intent: AgentIntent = 'FORECAST_HYBRID';

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

  buildSQL(input: AgentInput): string {
    const ctx = input.extraContext ?? {};
    const sourceSQL = ctx.sourceSQL as string;
    const horizon = (ctx.horizon as number | undefined) ?? DEFAULT_HORIZON;
    const historyMonths = (ctx.historyMonths as number | undefined) ?? DEFAULT_HISTORY_MONTHS;
    const dateCol = (ctx.dateCol as string | undefined) ?? DEFAULT_DATE_COL;
    const valueCol = (ctx.valueCol as string | undefined) ?? DEFAULT_VALUE_COL;

    return (
      `WITH SOURCE_DATA AS (\n${sourceSQL}\n)\n` +
      `SELECT * FROM TABLE(CORTEX_TESTING.ML.FORECAST_HYBRID(\n` +
      `  CURSOR(SELECT "${dateCol}", "${valueCol}" FROM SOURCE_DATA ORDER BY "${dateCol}"),\n` +
      `  ${horizon},\n` +
      `  ${historyMonths}\n` +
      `)) ORDER BY DS`
    );
  }

  parseResults(
    rows: Record<string, unknown>[],
    _columns: string[],
    input: AgentInput,
  ): ParsedData {
    const horizon = (input.extraContext?.horizon as number | undefined) ?? DEFAULT_HORIZON;

    // Extract model weights from the first forecast row if present
    const forecastRaws = rows.slice(Math.max(0, rows.length - horizon));
    const modelWeights = parseModelWeights(forecastRaws[0]?.['MODEL_WEIGHTS'])

    const extraInsights: string[] = modelWeights
      ? [`Ensemble model weights: ${formatWeights(modelWeights)}.`]
      : []

    const data = normalizeForecastResults({
      allRows: rows,
      horizon,
      modelName: 'Hybrid Ensemble',
      modelNotes: [
        'The hybrid ensemble combines Prophet, SARIMA, and XGBoost forecasts via optimised weighting.',
        'Model weights are dynamically determined based on in-sample accuracy of each constituent model.',
        'The ensemble typically outperforms any single model by reducing variance through diversification.',
      ],
      extraInsights,
    });

    return {
      data: { ...data, modelWeights },
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

function parseModelWeights(raw: unknown): Record<string, number> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, number>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, number>; } catch { return null; }
  }
  return null;
}

function formatWeights(weights: Record<string, number>): string {
  return Object.entries(weights)
    .map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const hybridForecastAgent = new HybridForecastAgent();
