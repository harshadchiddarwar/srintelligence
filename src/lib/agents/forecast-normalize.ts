/**
 * forecast-normalize.ts
 *
 * Shared utility that converts raw Snowflake UDTF rows (DS, YHAT, Y,
 * YHAT_LOWER, YHAT_UPPER, …) into the canonical shape expected by the
 * ForecastArtifact UI component.
 *
 * All v2 forecast agents (prophet, sarima, hw, xgboost, hybrid) import this
 * module so their parseResults() output is consistent with ForecastArtifact.
 */

// ---------------------------------------------------------------------------
// Output types (mirrored in ForecastArtifact.tsx)
// ---------------------------------------------------------------------------

export interface NormalizedForecastRow {
  date: string
  actuals?: number
  predicted?: number
  lower?: number
  upper?: number
  errorPct?: number
}

export interface NormalizedForecastMetrics {
  model?: string
  horizon?: number
  mae?: number
  /** Expressed as a percentage (0–100), not a fraction */
  mape?: number
  trainedOn?: string
  validatedOn?: string
}

export interface NormalizedForecastData {
  historical: NormalizedForecastRow[]
  forecast: NormalizedForecastRow[]
  /** Holdout validation rows — last 20 % of historical, with errorPct */
  validation: NormalizedForecastRow[]
  metrics: NormalizedForecastMetrics
  modelNotes: string[]
  insights: string[]
  summary: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NormalizeForecastOptions {
  /** All rows returned by the UDTF, sorted ascending by DS */
  allRows: Record<string, unknown>[]
  /** Number of future periods in the forecast */
  horizon: number
  /** Human-readable model name, e.g. "Prophet", "SARIMA" */
  modelName: string
  /** Algorithm-specific notes surfaced in the Model Notes section */
  modelNotes?: string[]
  /** Extra insight bullet points appended after auto-generated ones */
  extraInsights?: string[]
}

/**
 * Converts raw UDTF rows into the canonical ForecastData shape.
 *
 * Split strategy:
 *   • Last `horizon` rows  → forecast (future)
 *   • Remaining rows       → historical (actuals + model fit)
 *   • Last 20 % of historical rows → validation (holdout accuracy)
 */
export function normalizeForecastResults(
  opts: NormalizeForecastOptions,
): NormalizedForecastData {
  const { allRows, horizon, modelName, modelNotes = [], extraInsights = [] } = opts

  if (allRows.length === 0) {
    return {
      historical: [],
      forecast: [],
      validation: [],
      metrics: { model: modelName, horizon },
      modelNotes,
      insights: [],
      summary: `${modelName} forecast returned no results.`,
    }
  }

  const totalRows = allRows.length
  const historicalCount = Math.max(0, totalRows - horizon)

  const rawHistorical = allRows.slice(0, historicalCount)
  const rawForecast = allRows.slice(historicalCount)

  // ── Map rows ───────────────────────────────────────────────────────────────

  const historical: NormalizedForecastRow[] = rawHistorical.map(r => {
    const actuals = getNum(r, ['Y', 'y'])
    const predicted = getNum(r, ['YHAT', 'yhat'])
    return {
      date: getDate(r),
      actuals: actuals ?? undefined,
      predicted: predicted ?? undefined,
    }
  })

  const forecastRows: NormalizedForecastRow[] = rawForecast.map(r => {
    const predicted = getNum(r, ['YHAT', 'yhat'])
    const lower = getNum(r, ['YHAT_LOWER', 'yhat_lower'])
    const upper = getNum(r, ['YHAT_UPPER', 'yhat_upper'])
    return {
      date: getDate(r),
      predicted: predicted ?? undefined,
      lower: lower ?? undefined,
      upper: upper ?? undefined,
    }
  })

  // ── Validation rows (last 20 % of historical, min 4 rows) ─────────────────

  const valCount = Math.max(4, Math.round(historical.length * 0.2))
  const valStartIdx = Math.max(0, historical.length - valCount)
  const valRows = historical.slice(valStartIdx)

  const validation: NormalizedForecastRow[] = valRows.map(row => {
    const { actuals, predicted } = row
    const errorPct =
      actuals != null && actuals !== 0 && predicted != null
        ? Math.abs(actuals - predicted) / Math.abs(actuals) * 100
        : undefined
    return { ...row, errorPct }
  })

  // ── Accuracy metrics ───────────────────────────────────────────────────────

  const pairs = historical
    .filter(r => r.actuals != null && r.predicted != null)
    .map(r => ({ actual: r.actuals!, predicted: r.predicted! }))

  let mae: number | undefined
  let mape: number | undefined

  if (pairs.length > 0) {
    let absErrSum = 0
    let absPercErrSum = 0
    let mapeCount = 0

    for (const { actual, predicted } of pairs) {
      const err = Math.abs(actual - predicted)
      absErrSum += err
      if (actual !== 0) {
        absPercErrSum += err / Math.abs(actual)
        mapeCount++
      }
    }

    mae = absErrSum / pairs.length
    mape = mapeCount > 0 ? (absPercErrSum / mapeCount) * 100 : undefined
  }

  // ── Training / validation date ranges ─────────────────────────────────────

  const trainRows = historical.slice(0, valStartIdx)
  const trainStart = trainRows[0]?.date
  const trainEnd = trainRows[trainRows.length - 1]?.date
  const valStart = valRows[0]?.date
  const valEnd = valRows[valRows.length - 1]?.date

  const trainedOn =
    trainStart && trainEnd ? `${trainStart} – ${trainEnd}` : undefined
  const validatedOn =
    valStart && valEnd ? `${valStart} – ${valEnd}` : undefined

  // ── Trend direction ────────────────────────────────────────────────────────

  const firstFcst = forecastRows[0]?.predicted
  const lastFcst = forecastRows[forecastRows.length - 1]?.predicted
  let trendLabel = 'flat'
  let trendPct = 0

  if (firstFcst != null && lastFcst != null && firstFcst !== 0) {
    trendPct = ((lastFcst - firstFcst) / Math.abs(firstFcst)) * 100
    if (trendPct > 3) trendLabel = `upward (+${trendPct.toFixed(1)}%)`
    else if (trendPct < -3) trendLabel = `downward (${trendPct.toFixed(1)}%)`
    else trendLabel = 'flat'
  }

  // ── Auto-generated insights ────────────────────────────────────────────────

  const insights: string[] = []

  if (mape != null) {
    const acc = mape < 10 ? 'high' : mape < 20 ? 'moderate' : 'low'
    insights.push(
      `Model achieved ${acc} accuracy with a MAPE of ${mape.toFixed(1)}% on the validation period.`,
    )
  }

  if (firstFcst != null && lastFcst != null) {
    insights.push(
      `${horizon}-${horizon === 1 ? 'period' : 'period'} forecast shows a ${trendLabel} trend.`,
    )
  }

  const peakRow = forecastRows.reduce<NormalizedForecastRow | null>(
    (best, r) =>
      r.predicted != null && (best === null || r.predicted > (best.predicted ?? -Infinity))
        ? r
        : best,
    null,
  )
  if (peakRow?.predicted != null) {
    insights.push(
      `Peak forecast value of ${peakRow.predicted.toLocaleString(undefined, { maximumFractionDigits: 2 })} is expected around ${peakRow.date}.`,
    )
  }

  if (mae != null) {
    insights.push(
      `Mean absolute error (MAE) of ${mae.toLocaleString(undefined, { maximumFractionDigits: 2 })} on historical fit.`,
    )
  }

  insights.push(...extraInsights)

  // ── Summary ────────────────────────────────────────────────────────────────

  const summary =
    `${modelName} ${horizon}-period forecast: ${trendLabel} trend.` +
    (mape != null ? ` Historical MAPE: ${mape.toFixed(1)}%.` : '')

  // ── Assemble ───────────────────────────────────────────────────────────────

  return {
    historical,
    forecast: forecastRows,
    validation,
    metrics: {
      model: modelName,
      horizon,
      mae,
      mape,
      trainedOn,
      validatedOn,
    },
    modelNotes,
    insights,
    summary,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getDate(row: Record<string, unknown>): string {
  const v = row['DS'] ?? row['ds'] ?? row['date'] ?? row['week'] ?? row['period'] ?? ''
  return String(v)
}

function getNum(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k]
    if (v == null) continue
    const n = Number(v)
    if (!isNaN(n)) return n
  }
  return null
}
