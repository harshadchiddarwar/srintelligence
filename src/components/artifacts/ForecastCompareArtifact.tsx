"use client"

import type { AgentArtifact } from '../../types/agent'
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts'

interface ModelEntry {
  name: string
  mape: number
  mae?: number
  lastForecast?: number
  trend?: string
  status?: string
}

interface CompareData {
  models?: ModelEntry[]
  winner?: string
}

interface Props {
  artifact: AgentArtifact
}

function trendLabel(trend?: string) {
  if (!trend) return null
  const t = trend.toLowerCase()
  if (t === 'up' || t === 'increasing') return <span className="text-green-600 text-xs">▲ Up</span>
  if (t === 'down' || t === 'decreasing') return <span className="text-red-500 text-xs">▼ Down</span>
  return <span className="text-gray-500 text-xs">→ Flat</span>
}

export default function ForecastCompareArtifact({ artifact }: Props) {
  const data = (artifact.data ?? {}) as CompareData
  const models = data.models ?? []
  const winner = data.winner ?? ''

  const sorted = [...models].sort((a, b) => (a.mape ?? 999) - (b.mape ?? 999))

  return (
    <div className="flex flex-col gap-4">
      {/* Winner banner */}
      {winner && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="text-lg">🏆</span>
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {winner} wins
            </p>
            {(() => {
              const w = models.find(m => m.name.toLowerCase() === winner.toLowerCase())
              return w ? (
                <p className="text-xs text-amber-700">
                  with {w.mape.toFixed(1)}% MAPE
                  {w.mae != null && ` · MAE ${w.mae.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </p>
              ) : null
            })()}
          </div>
        </div>
      )}

      {/* Comparison table */}
      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Model</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600">MAPE</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600">MAE</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Last Forecast</th>
                <th className="px-3 py-2.5 text-center font-semibold text-gray-600">Trend</th>
                <th className="px-3 py-2.5 text-center font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((model, i) => {
                const isWinner = model.name.toLowerCase() === winner.toLowerCase()
                return (
                  <tr
                    key={model.name}
                    className={
                      isWinner
                        ? 'bg-amber-50 border-l-4 border-l-amber-400'
                        : i % 2 === 0
                        ? 'bg-white'
                        : 'bg-gray-50/60'
                    }
                  >
                    <td className="px-3 py-2 font-medium text-gray-800">
                      {isWinner && <span className="mr-1">🏆</span>}
                      {model.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span
                        className={
                          model.mape < 10
                            ? 'text-green-700 font-semibold'
                            : model.mape < 20
                            ? 'text-yellow-700'
                            : 'text-red-600'
                        }
                      >
                        {model.mape.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {model.mae?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {model.lastForecast?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-center">{trendLabel(model.trend)}</td>
                    <td className="px-3 py-2 text-center">
                      {model.status && (
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            model.status === 'converged'
                              ? 'bg-green-100 text-green-700'
                              : model.status === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {model.status}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MAPE bar chart */}
      {sorted.length > 0 && (
        <div className="w-full h-48">
          <p className="text-xs font-medium text-gray-500 mb-1">MAPE by Model (lower is better)</p>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 72 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} unit="%" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={70} />
              <Tooltip
                formatter={(value) => [`${(typeof value === 'number' ? value : Number(value ?? 0)).toFixed(1)}%`, 'MAPE'] as [string, string]}
              />
              <Bar dataKey="mape" radius={[0, 3, 3, 0]}>
                {sorted.map(model => (
                  <Cell
                    key={model.name}
                    fill={model.name.toLowerCase() === winner.toLowerCase() ? '#f59e0b' : '#6366f1'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
