"use client"

import type { AgentArtifact } from '../../types/agent'

interface Segment {
  name: string
  size: number      // fraction 0-1 or absolute count; if > 1 treated as count
  characteristics?: string[]
  zScores?: Record<string, number>
  confidence?: number
}

interface ClusterData {
  segments?: Segment[]
}

interface Props {
  artifact: AgentArtifact
}

function ConfidenceBadge({ confidence }: { confidence?: number }) {
  if (confidence == null) return null
  const pct = confidence > 1 ? confidence : confidence * 100
  let classes: string
  if (pct >= 80) classes = 'bg-green-100 text-green-800 border-green-200'
  else if (pct >= 60) classes = 'bg-yellow-100 text-yellow-800 border-yellow-200'
  else classes = 'bg-red-100 text-red-700 border-red-200'

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${classes}`}>
      {pct.toFixed(0)}% conf.
    </span>
  )
}

function ZScoreBar({ label, z }: { label: string; z: number }) {
  const abs = Math.abs(z)
  // Only show if |z| > 1.0
  if (abs <= 1.0) return null
  const pct = Math.min(abs * 20, 100) // scale: z=5 → 100%
  const isPos = z > 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 truncate text-gray-600" title={label}>{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${isPos ? 'bg-indigo-400' : 'bg-rose-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`w-10 text-right font-mono tabular-nums ${isPos ? 'text-indigo-700' : 'text-rose-700'}`}>
        {z > 0 ? '+' : ''}{z.toFixed(2)}
      </span>
    </div>
  )
}

export default function ClusterProfileArtifact({ artifact }: Props) {
  const data = (artifact.data ?? {}) as ClusterData
  const segments = data.segments ?? []

  if (segments.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic">No segment data available.</p>
    )
  }

  // Compute total size for percentage calculation
  const totalSize = segments.reduce((acc, s) => {
    // if sizes are fractions (<= 1), sum may be ~1; if counts, sum is total N
    return acc + s.size
  }, 0)

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {segments.map((seg, i) => {
        const sizePct =
          totalSize > 0
            ? seg.size <= 1
              ? seg.size * 100
              : (seg.size / totalSize) * 100
            : 0

        const significantZs = Object.entries(seg.zScores ?? {}).filter(([, z]) => Math.abs(z) > 1.0)

        const CARD_COLORS = [
          'border-indigo-200 bg-indigo-50',
          'border-violet-200 bg-violet-50',
          'border-sky-200 bg-sky-50',
          'border-teal-200 bg-teal-50',
          'border-rose-200 bg-rose-50',
          'border-amber-200 bg-amber-50',
        ]
        const colorClass = CARD_COLORS[i % CARD_COLORS.length]

        return (
          <div
            key={seg.name ?? i}
            className={`rounded-xl border ${colorClass} p-4 flex flex-col gap-3 shadow-sm`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-gray-800">{seg.name ?? `Segment ${i + 1}`}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {sizePct.toFixed(1)}% of total
                  {seg.size > 1 && ` (n=${seg.size.toLocaleString()})`}
                </p>
              </div>
              <ConfidenceBadge confidence={seg.confidence} />
            </div>

            {/* Size bar */}
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-current rounded-full opacity-60"
                style={{ width: `${Math.min(sizePct, 100)}%` }}
              />
            </div>

            {/* Characteristics */}
            {seg.characteristics && seg.characteristics.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">Key Characteristics</p>
                <ul className="flex flex-col gap-1">
                  {seg.characteristics.map((c, ci) => (
                    <li key={ci} className="flex items-start gap-1.5 text-xs text-gray-700">
                      <span className="mt-0.5 shrink-0 text-gray-400">•</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Z-score bars */}
            {significantZs.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">
                  Distinguishing Features (|z| &gt; 1)
                </p>
                <div className="flex flex-col gap-1.5">
                  {significantZs
                    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                    .slice(0, 6)
                    .map(([label, z]) => (
                      <ZScoreBar key={label} label={label} z={z} />
                    ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
