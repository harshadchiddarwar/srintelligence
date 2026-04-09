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
    if (rows.length === 0) {
      return {
        data: { historical: [], forecast: [], metrics: {} },
        narrative: 'Hybrid forecast returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const horizon = (input.extraContext?.horizon as number | undefined) ?? DEFAULT_HORIZON;
    const totalRows = rows.length;
    const historicalCount = Math.max(0, totalRows - horizon);

    const historical = rows.slice(0, historicalCount);
    const forecast = rows.slice(historicalCount);

    const metrics = computeAccuracyMetrics(historical);

    // Extract model weights from first forecast row if available
    const modelWeights = parseModelWeights(forecast[0]?.['MODEL_WEIGHTS']);

    const trendLabel = deriveTrend(forecast[0], forecast[forecast.length - 1]);
    const narrative =
      `Hybrid ensemble ${horizon}-week forecast: ${trendLabel}. ` +
      (metrics.mape !== undefined
        ? `Historical MAPE: ${(metrics.mape * 100).toFixed(1)}%.`
        : 'Accuracy metrics unavailable.') +
      (modelWeights ? ` Ensemble weights: ${formatWeights(modelWeights)}.` : '');

    return {
      data: { historical, forecast, metrics, modelWeights },
      narrative,
      metadata: { horizon, historicalCount, forecastCount: forecast.length, totalRows },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeAccuracyMetrics(historical: Record<string, unknown>[]) {
  const pairs: Array<{ actual: number; predicted: number }> = [];
  for (const row of historical) {
    const yhat = toNumber(row['YHAT'] ?? row['yhat']);
    const y = toNumber(row['Y'] ?? row['y']);
    if (yhat !== null && y !== null) pairs.push({ actual: y, predicted: yhat });
  }
  if (pairs.length === 0) return {};

  let absErrorSum = 0;
  let absPercErrorSum = 0;
  let mapeCount = 0;

  for (const { actual, predicted } of pairs) {
    const err = Math.abs(actual - predicted);
    absErrorSum += err;
    if (actual !== 0) { absPercErrorSum += err / Math.abs(actual); mapeCount++; }
  }

  return {
    mae: absErrorSum / pairs.length,
    mape: mapeCount > 0 ? absPercErrorSum / mapeCount : undefined,
  };
}

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

function deriveTrend(
  first: Record<string, unknown> | undefined,
  last: Record<string, unknown> | undefined,
): string {
  if (!first || !last) return 'flat';
  const firstVal = toNumber(first['YHAT'] ?? first['yhat']);
  const lastVal = toNumber(last['YHAT'] ?? last['yhat']);
  if (firstVal === null || lastVal === null) return 'flat';
  const pct = firstVal !== 0 ? ((lastVal - firstVal) / Math.abs(firstVal)) * 100 : 0;
  if (pct > 3) return `upward trend (+${pct.toFixed(1)}%)`;
  if (pct < -3) return `downward trend (${pct.toFixed(1)}%)`;
  return 'relatively flat';
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const hybridForecastAgent = new HybridForecastAgent();
