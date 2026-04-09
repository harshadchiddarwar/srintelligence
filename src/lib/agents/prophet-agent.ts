/**
 * ProphetAgent — time-series forecasting via CORTEX_TESTING.ML.PROPHET_CALCULATE UDTF.
 *
 * Wraps caller-supplied source SQL as a CTE and passes its output through
 * the Prophet UDTF. Distinguishes historical fit rows from forecast rows by
 * comparing DS values against the maximum historical date in the result set.
 *
 * Expected UDTF output columns: DS, YHAT (and optionally YHAT_LOWER, YHAT_UPPER,
 * TREND, RESIDUAL).
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_HORIZON = 13;
const DEFAULT_HISTORY_MONTHS = 24;
const DEFAULT_DATE_COL = 'WEEK_DATE';
const DEFAULT_VALUE_COL = 'METRIC_VALUE';

// ---------------------------------------------------------------------------
// ProphetAgent
// ---------------------------------------------------------------------------

export class ProphetAgent extends BaseAgent {
  readonly name = 'prophet';
  readonly displayName = 'Prophet Forecast';
  readonly description =
    'Facebook Prophet time-series forecasting with trend and seasonality decomposition.';
  readonly intent: AgentIntent = 'FORECAST_PROPHET';

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
      `SELECT * FROM TABLE(CORTEX_TESTING.ML.PROPHET_CALCULATE(\n` +
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
    if (rows.length === 0) {
      return {
        data: { historical: [], forecast: [], metrics: {} },
        narrative: 'Prophet forecast returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const horizon = (input.extraContext?.horizon as number | undefined) ?? DEFAULT_HORIZON;

    // Find the split point: rows where DS exceeds the last historical DS
    // The UDTF typically returns historical rows first, then forecast rows.
    // We identify the boundary as the point where YHAT values start for
    // future dates. If a TREND column is absent for forecast rows, we use
    // a count-based heuristic (last `horizon` rows = forecast).
    const totalRows = rows.length;
    const historicalCount = Math.max(0, totalRows - horizon);

    const historical = rows.slice(0, historicalCount);
    const forecast = rows.slice(historicalCount);

    // Compute accuracy metrics from historical fit (requires YHAT and actual value)
    const metrics = computeAccuracyMetrics(historical);

    // Identify trend direction from forecast
    const firstForecast = forecast[0];
    const lastForecast = forecast[forecast.length - 1];
    const trendLabel = deriveTrend(firstForecast, lastForecast);

    const narrative =
      `Prophet ${horizon}-week forecast: ${trendLabel}. ` +
      (metrics.mape !== undefined
        ? `Historical MAPE: ${(metrics.mape * 100).toFixed(1)}%.`
        : 'Accuracy metrics unavailable.');

    return {
      data: { historical, forecast, metrics },
      narrative,
      metadata: {
        horizon,
        historicalCount,
        forecastCount: forecast.length,
        totalRows,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AccuracyMetrics {
  mae?: number;
  mape?: number;
}

function computeAccuracyMetrics(historical: Record<string, unknown>[]): AccuracyMetrics {
  const pairs: Array<{ actual: number; predicted: number }> = [];

  for (const row of historical) {
    // UDTF may expose YHAT (predicted) and Y (actual) columns
    const yhat = toNumber(row['YHAT'] ?? row['yhat']);
    const y = toNumber(row['Y'] ?? row['y']);
    if (yhat !== null && y !== null) {
      pairs.push({ actual: y, predicted: yhat });
    }
  }

  if (pairs.length === 0) return {};

  let absErrorSum = 0;
  let absPercErrorSum = 0;
  let mapeCount = 0;

  for (const { actual, predicted } of pairs) {
    const err = Math.abs(actual - predicted);
    absErrorSum += err;
    if (actual !== 0) {
      absPercErrorSum += err / Math.abs(actual);
      mapeCount++;
    }
  }

  const mae = absErrorSum / pairs.length;
  const mape = mapeCount > 0 ? absPercErrorSum / mapeCount : undefined;

  return { mae, mape };
}

function deriveTrend(
  first: Record<string, unknown> | undefined,
  last: Record<string, unknown> | undefined,
): string {
  if (!first || !last) return 'flat';
  const firstVal = toNumber(first['YHAT'] ?? first['yhat']);
  const lastVal = toNumber(last['YHAT'] ?? last['yhat']);
  if (firstVal === null || lastVal === null) return 'flat';
  const delta = lastVal - firstVal;
  const pct = firstVal !== 0 ? (delta / Math.abs(firstVal)) * 100 : 0;
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

export const prophetAgent = new ProphetAgent();
