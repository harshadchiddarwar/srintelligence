"use client"

import type { AgentArtifact } from '../../types/agent'

interface WaterfallItem {
  label: string
  value: number
  type: 'increase' | 'decrease' | 'total'
}

interface WaterfallData {
  items?: WaterfallItem[]
  baseline?: number
  target?: number
}

interface Props {
  artifact: AgentArtifact
}

function colorForType(type: WaterfallItem['type']) {
  switch (type) {
    case 'increase': return { bg: 'bg-green-100', text: 'text-green-800', bar: 'bg-green-500', border: 'border-green-200' }
    case 'decrease': return { bg: 'bg-red-100', text: 'text-red-800', bar: 'bg-red-400', border: 'border-red-200' }
    case 'total': return { bg: 'bg-blue-100', text: 'text-blue-800', bar: 'bg-blue-500', border: 'border-blue-200' }
  }
}

export default function WaterfallArtifact({ artifact }: Props) {
  const data = (artifact.data ?? {}) as WaterfallData
  const items = data.items ?? []
  const baseline = data.baseline ?? 0
  const target = data.target

  // Compute max absolute value for bar scaling
  const maxAbs = Math.max(...items.map(it => Math.abs(it.value)), 1)

  // Running total starting from baseline
  let running = baseline

  return (
    <div className="flex flex-col gap-3">
      {/* Baseline / Target summary */}
      <div className="flex flex-wrap gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-400" />
          <span className="text-gray-600">
            Baseline:{' '}
            <span className="font-semibold text-gray-800">
              {baseline.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </span>
        </div>
        {target != null && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-indigo-400" />
            <span className="text-gray-600">
              Target:{' '}
              <span className="font-semibold text-gray-800">
                {target.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" /> Increase</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" /> Decrease</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" /> Total</span>
        </div>
      </div>

      {/* Waterfall table with CSS bars */}
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No waterfall items.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Factor</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Contribution</th>
                <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Running Total</th>
                <th className="px-3 py-2.5 text-left font-semibold text-gray-600 w-40 min-w-32">Visual</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const c = colorForType(item.type)
                const prevRunning = running
                if (item.type !== 'total') {
                  running += item.value
                } else {
                  // 'total' shows absolute accumulated value
                  running = item.value !== 0 ? item.value : running
                }
                const barPct = (Math.abs(item.value) / maxAbs) * 100

                return (
                  <tr
                    key={i}
                    className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} border-b border-gray-100 last:border-0`}
                  >
                    <td className={`px-3 py-2 font-medium ${c.text}`}>
                      {item.type === 'total' ? (
                        <span className="font-bold">{item.label}</span>
                      ) : (
                        item.label
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-mono ${c.text}`}>
                      {item.value > 0 && item.type !== 'total' ? '+' : ''}
                      {item.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-mono text-gray-700">
                      {(item.type === 'total' ? item.value : prevRunning + item.value).toLocaleString(
                        undefined,
                        { maximumFractionDigits: 2 },
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="h-4 bg-gray-100 rounded-sm overflow-hidden">
                        <div
                          className={`h-full rounded-sm ${c.bar} transition-all`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
