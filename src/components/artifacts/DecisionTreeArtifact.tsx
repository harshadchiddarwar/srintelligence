"use client"

import type { AgentArtifact } from '../../types/agent'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface Driver {
  feature: string
  importance: number
  direction: 'positive' | 'negative' | string
  magnitude?: number
}

interface TreeData {
  drivers?: Driver[]
  narrative?: string
}

interface Props {
  artifact: AgentArtifact
}

export default function DecisionTreeArtifact({ artifact }: Props) {
  const data = (artifact.data ?? {}) as TreeData
  const allDrivers = data.drivers ?? []
  const narrative = data.narrative ?? artifact.narrative ?? ''

  // Top 10 drivers, sorted by absolute importance
  const drivers = [...allDrivers]
    .sort((a, b) => Math.abs(b.importance) - Math.abs(a.importance))
    .slice(0, 10)

  // For recharts horizontal bar we keep values as absolute, color by direction
  const chartData = drivers.map(d => ({
    name: d.feature,
    importance: Math.abs(d.importance),
    direction: d.direction,
    raw: d.importance,
  }))

  return (
    <div className="flex flex-col gap-4">
      {/* Horizontal bar chart */}
      {chartData.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
            Feature Importance (Top {chartData.length})
          </p>
          <div style={{ height: Math.max(180, chartData.length * 32) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 24, bottom: 4, left: 140 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  width={135}
                />
                <Tooltip
                  formatter={(value, _name, props) => {
                    const raw = (props?.payload as Record<string, unknown>)?.['raw'] as number | undefined;
                    const v = typeof value === 'number' ? value : Number(value ?? 0);
                    return [
                      raw != null
                        ? `${raw >= 0 ? '+' : ''}${raw.toFixed(4)}`
                        : v.toFixed(4),
                      'Importance',
                    ] as [string, string];
                  }}
                />
                <Bar dataKey="importance" radius={[0, 3, 3, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.direction === 'positive' || entry.raw >= 0
                          ? '#6366f1'
                          : '#ef4444'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No driver data available.</p>
      )}

      {/* Ranked list */}
      {drivers.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            Ranked Drivers
          </p>
          {drivers.map((d, i) => {
            const isPos = d.direction === 'positive' || d.importance >= 0
            const pct = drivers[0]
              ? (Math.abs(d.importance) / Math.abs(drivers[0].importance)) * 100
              : 0
            return (
              <div key={d.feature} className="flex items-center gap-3 text-xs">
                <span className="w-5 shrink-0 text-right text-gray-400 font-medium">
                  {i + 1}.
                </span>
                <span className="w-40 shrink-0 truncate text-gray-700 font-medium">
                  {d.feature}
                </span>
                {/* Bar */}
                <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${isPos ? 'bg-indigo-500' : 'bg-red-400'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span
                  className={`w-16 text-right tabular-nums font-mono ${
                    isPos ? 'text-indigo-700' : 'text-red-600'
                  }`}
                >
                  {d.importance >= 0 ? '+' : ''}
                  {d.importance.toFixed(4)}
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${
                    isPos
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  {isPos ? '▲' : '▼'} {d.direction ?? (isPos ? 'positive' : 'negative')}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Narrative */}
      {narrative && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 leading-relaxed">
          {narrative}
        </div>
      )}
    </div>
  )
}
