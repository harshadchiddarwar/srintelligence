/**
 * XGBoostAgent — gradient-boosted tree forecasting via CORTEX_TESTING.ML.XGB_CALCULATE_V3 UDTF.
 *
 * Supports optional exogenous features:
 *   - extraContext.exogFeatures: string[]               — columns in sourceSQL to use as exog vars
 *   - extraContext.futureExog:   Record<string,number[]> — future values aligned to horizon steps
 *
 * When no exogenous features are specified the UDTF is called with NULL placeholders
 * for both the exog cursor and the future exog JSON, matching the V3 signature.
 *
 * Expected UDTF output columns: DS, YHAT (and optionally YHAT_LOWER, YHAT_UPPER, IMPORTANCE_*).
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
// XGBoostAgent
// ---------------------------------------------------------------------------

export class XGBoostAgent extends BaseAgent {
  readonly name = 'xgboost';
  readonly displayName = 'XGBoost Forecast';
  readonly description =
    'XGBoost gradient-boosted tree forecasting with optional exogenous feature support.';
  readonly intent: AgentIntent = 'FORECAST_XGB';

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

    const exogFeatures = input.extraContext?.exogFeatures as string[] | undefined;
    const futureExog = input.extraContext?.futureExog as Record<string, number[]> | undefined;

    if (exogFeatures && !Array.isArray(exogFeatures)) {
      return { valid: false, error: 'exogFeatures must be an array of column name strings.' };
    }

    if (exogFeatures && futureExog) {
      // Validate that each exog feature has exactly `horizon` future values
      const h = horizon ?? DEFAULT_HORIZON;
      for (const feat of exogFeatures) {
        const vals = futureExog[feat];
        if (vals && vals.length !== h) {
          return {
            valid: false,
            error: `futureExog["${feat}"] must have exactly ${h} values (one per horizon step).`,
          };
        }
      }
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
    const exogFeatures = ctx.exogFeatures as string[] | undefined;
    const futureExog = ctx.futureExog as Record<string, number[]> | undefined;

    const hasExog = Array.isArray(exogFeatures) && exogFeatures.length > 0;

    if (!hasExog) {
      // No exogenous features — pass NULLs for both exog arguments
      return (
        `WITH SOURCE_DATA AS (\n${sourceSQL}\n)\n` +
        `SELECT * FROM TABLE(CORTEX_TESTING.ML.XGB_CALCULATE_V3(\n` +
        `  CURSOR(SELECT "${dateCol}", "${valueCol}" FROM SOURCE_DATA ORDER BY "${dateCol}"),\n` +
        `  ${horizon},\n` +
        `  NULL::VARIANT,\n` +
        `  NULL::VARIANT\n` +
        `)) ORDER BY DS`
      );
    }

    // Build the exogenous column list for the historical cursor
    const exogCols = exogFeatures!.map((c) => `"${c}"`).join(', ');

    // Build the futureExog JSON literal (VARIANT)
    const futureExogJson = buildFutureExogJson(exogFeatures!, futureExog ?? {});

    return (
      `WITH SOURCE_DATA AS (\n${sourceSQL}\n)\n` +
      `SELECT * FROM TABLE(CORTEX_TESTING.ML.XGB_CALCULATE_V3(\n` +
      `  CURSOR(SELECT "${dateCol}", "${valueCol}" FROM SOURCE_DATA ORDER BY "${dateCol}"),\n` +
      `  ${horizon},\n` +
      `  CURSOR(SELECT ${exogCols} FROM SOURCE_DATA ORDER BY "${dateCol}"),\n` +
      `  ${futureExogJson}::VARIANT\n` +
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
        data: { historical: [], forecast: [], metrics: {}, featureImportance: [] },
        narrative: 'XGBoost forecast returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const horizon = (input.extraContext?.horizon as number | undefined) ?? DEFAULT_HORIZON;
    const totalRows = rows.length;
    const historicalCount = Math.max(0, totalRows - horizon);

    const historical = rows.slice(0, historicalCount);
    const forecast = rows.slice(historicalCount);

    const metrics = computeAccuracyMetrics(historical);
    const trendLabel = deriveTrend(forecast[0], forecast[forecast.length - 1]);

    // Extract feature importance columns if present (IMPORTANCE_<feature> pattern)
    const featureImportance = extractFeatureImportance(rows[0]);

    const narrative =
      `XGBoost ${horizon}-week forecast: ${trendLabel}. ` +
      (metrics.mape !== undefined
        ? `Historical MAPE: ${(metrics.mape * 100).toFixed(1)}%.`
        : 'Accuracy metrics unavailable.');

    return {
      data: { historical, forecast, metrics, featureImportance },
      narrative,
      metadata: {
        horizon,
        historicalCount,
        forecastCount: forecast.length,
        totalRows,
        hasExogFeatures: Boolean(
          (input.extraContext?.exogFeatures as unknown[])?.length,
        ),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialize future exogenous values as a compact JSON object literal that
 * Snowflake can parse via the ::VARIANT cast.
 *
 * Shape: { "feature1": [v1, v2, ...], "feature2": [v1, v2, ...] }
 */
function buildFutureExogJson(
  features: string[],
  futureExog: Record<string, number[]>,
): string {
  const obj: Record<string, number[]> = {};
  for (const feat of features) {
    obj[feat] = futureExog[feat] ?? [];
  }
  return `'${JSON.stringify(obj).replace(/'/g, "''")}'`;
}

/** Extract IMPORTANCE_* columns from the first result row. */
function extractFeatureImportance(
  row: Record<string, unknown> | undefined,
): Array<{ feature: string; importance: number }> {
  if (!row) return [];
  const result: Array<{ feature: string; importance: number }> = [];
  for (const [key, val] of Object.entries(row)) {
    if (key.toUpperCase().startsWith('IMPORTANCE_')) {
      const feature = key.slice('IMPORTANCE_'.length);
      const importance = toNumber(val);
      if (importance !== null) {
        result.push({ feature, importance });
      }
    }
  }
  return result.sort((a, b) => b.importance - a.importance);
}

interface AccuracyMetrics {
  mae?: number;
  mape?: number;
}

function computeAccuracyMetrics(historical: Record<string, unknown>[]): AccuracyMetrics {
  const pairs: Array<{ actual: number; predicted: number }> = [];

  for (const row of historical) {
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

  return {
    mae: absErrorSum / pairs.length,
    mape: mapeCount > 0 ? absPercErrorSum / mapeCount : undefined,
  };
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

export const xgboostAgent = new XGBoostAgent();
