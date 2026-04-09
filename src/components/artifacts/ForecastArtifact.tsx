"use client"

import type { AgentArtifact } from '../../types/agent'
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'

interface ForecastPoint {
  date: string
  value: number
  lower?: number
  upper?: number
}

interface ForecastMetrics {
  mape?: number
  mae?: number
  model?: string
  horizon?: number
}

interface ForecastData {
  historical?: ForecastPoint[]
  forecast?: ForecastPoint[]
  metrics?: ForecastMetrics
}

interface Props {
  artifact: AgentArtifact
}

function AccuracyBadge({ mape }: { mape?: number }) {
  if (mape == null) return null

  let label: string
  let classes: string

  if (mape < 10) {
    label = `High accuracy (${mape.toFixed(1)}% MAPE)`
    classes = 'bg-green-100 text-green-800 border-green-200'
  } else if (mape < 20) {
    label = `Moderate accuracy (${mape.toFixed(1)}% MAPE)`
    classes = 'bg-yellow-100 text-yellow-800 border-yellow-200'
  } else {
    label = `Low accuracy (${mape.toFixed(1)}% MAPE)`
    classes = 'bg-red-100 text-red-800 border-red-200'
  }

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${classes}`}>
      {label}
    </span>
  )
}

// Custom tooltip for the chart
function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ color: string; name: string; value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : p.value}
        </p>
      ))}
    </div>
  )
}

export default function ForecastArtifact({ artifact }: Props) {
  const data = (artifact.data ?? {}) as ForecastData
  const historical = data.historical ?? []
  const forecast = data.forecast ?? []
  const metrics = data.metrics ?? {}

  // Build combined series for recharts
  const chartData = [
    ...historical.map(p => ({
      date: p.date,
      Historical: p.value,
      Forecast: undefined as number | undefined,
      'CI Lower': undefined as number | undefined,
      'CI Upper': undefined as number | undefined,
    })),
    ...forecast.map(p => ({
      date: p.date,
      Historical: undefined as number | undefined,
      Forecast: p.value,
      'CI Lower': p.lower,
      'CI Upper': p.upper,
    })),
  ]

  // Find boundary date (last historical point)
  const boundaryDate = historical.length > 0 ? historical[historical.length - 1]?.date : undefined

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        {metrics.model && (
          <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2.5 py-0.5 border border-gray-200">
            {metrics.model}
          </span>
        )}
        <AccuracyBadge mape={metrics.mape} />
        {metrics.horizon && (
          <span className="text-xs text-gray-500">
            {metrics.horizon}-period horizon
          </span>
        )}
        {metrics.mae != null && (
          <span className="text-xs text-gray-500">
            MAE: {metrics.mae.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        )}
      </div>

      {/* Chart */}
      {chartData.length > 0 ? (
        <div className="w-full h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={v => {
                  // Shorten date labels
                  if (typeof v === 'string' && v.length > 7) return v.slice(0, 7)
                  return v
                }}
              />
              <YAxis tick={{ fontSize: 10 }} width={60} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {boundaryDate && (
                <ReferenceLine
                  x={boundaryDate}
                  stroke="#9ca3af"
                  strokeDasharray="4 4"
                  label={{ value: 'Forecast start', fontSize: 10, fill: '#6b7280' }}
                />
              )}
              <Line
                type="monotone"
                dataKey="Historical"
                stroke="#6366f1"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="Forecast"
                stroke="#22c55e"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="CI Lower"
                stroke="#86efac"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="CI Upper"
                stroke="#86efac"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-sm text-gray-400 italic text-center py-8">No forecast data to chart.</div>
      )}

      {/* Forecast summary table */}
      {forecast.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Date</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Forecast</th>
                {forecast.some(f => f.lower != null) && (
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Lower CI</th>
                )}
                {forecast.some(f => f.upper != null) && (
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Upper CI</th>
                )}
              </tr>
            </thead>
            <tbody>
              {forecast.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                  <td className="px-3 py-1.5 text-gray-700">{row.date}</td>
                  <td className="px-3 py-1.5 text-right text-gray-800 font-medium">
                    {row.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  {forecast.some(f => f.lower != null) && (
                    <td className="px-3 py-1.5 text-right text-gray-500">
                      {row.lower?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}
                    </td>
                  )}
                  {forecast.some(f => f.upper != null) && (
                    <td className="px-3 py-1.5 text-right text-gray-500">
                      {row.upper?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
