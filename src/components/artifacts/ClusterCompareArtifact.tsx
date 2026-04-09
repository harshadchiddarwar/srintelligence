"use client"

/**
 * ClusterCompareArtifact — renders a clustering algorithm comparison result.
 *
 * Shows:
 *   • Winner banner with silhouette score or segment count
 *   • Comparison table: all 5 algorithms × success, segments, silhouette
 *   • Expandable segment profile for each successful algorithm
 */

import { useState } from 'react'
import type { AgentArtifact } from '../../types/agent'

interface Props {
  artifact: AgentArtifact
}

interface AlgorithmResult {
  algorithmName: string
  displayName: string
  success: boolean
  segmentCount?: number
  silhouetteScore?: number
  error?: string
  segments?: Array<{
    id: number
    label: string
    size: number
    characteristics: string[]
  }>
}

interface WinnerInfo {
  algorithmName: string
  displayName: string
  segmentCount?: number
  silhouetteScore?: number
}

export default function ClusterCompareArtifact({ artifact }: Props) {
  const [expandedAlgo, setExpandedAlgo] = useState<string | null>(null)

  const data = artifact.data as Record<string, unknown> | null
  if (!data) {
    return <p className="text-sm text-gray-500 italic">No comparison data available.</p>
  }

  const algorithms = (data['algorithms'] as AlgorithmResult[] | undefined) ?? []
  const winner = data['winner'] as WinnerInfo | null | undefined
  const successCount = data['successCount'] as number | undefined
  const failureCount = data['failureCount'] as number | undefined

  return (
    <div className="space-y-4">
      {/* Winner Banner */}
      {winner && (
        <div className="rounded-xl border-2 border-indigo-300 bg-indigo-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏆</span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-indigo-500 mb-0.5">
                Best Algorithm
              </div>
              <div className="text-lg font-bold text-indigo-900">{winner.displayName}</div>
              <div className="text-sm text-indigo-700">
                {winner.silhouetteScore != null
                  ? `Silhouette score: ${winner.silhouetteScore.toFixed(3)}`
                  : winner.segmentCount != null
                    ? `${winner.segmentCount} segment(s)`
                    : ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary counts */}
      {(successCount != null || failureCount != null) && (
        <div className="flex gap-3">
          <div className="flex-1 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-center">
            <div className="text-xl font-bold text-green-700">{successCount ?? 0}</div>
            <div className="text-xs text-green-600 mt-0.5">Succeeded</div>
          </div>
          <div className="flex-1 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-center">
            <div className="text-xl font-bold text-red-700">{failureCount ?? 0}</div>
            <div className="text-xs text-red-600 mt-0.5">Failed</div>
          </div>
        </div>
      )}

      {/* Comparison Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left font-medium text-gray-600 border border-gray-200">Algorithm</th>
              <th className="px-3 py-2 text-center font-medium text-gray-600 border border-gray-200">Status</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 border border-gray-200">Segments</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600 border border-gray-200">Silhouette</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 border border-gray-200">Details</th>
            </tr>
          </thead>
          <tbody>
            {algorithms.map((algo, i) => {
              const isWinner = winner?.algorithmName === algo.algorithmName
              return (
                <tr
                  key={i}
                  className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${isWinner ? 'ring-1 ring-inset ring-indigo-300' : ''}`}
                >
                  <td className="px-3 py-2 border border-gray-200 font-medium">
                    {algo.displayName}
                    {isWinner && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">
                        Best
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 border border-gray-200 text-center">
                    {algo.success ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">✓ Success</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">✗ Failed</span>
                    )}
                  </td>
                  <td className="px-3 py-2 border border-gray-200 text-right font-mono">
                    {algo.segmentCount != null ? algo.segmentCount : '—'}
                  </td>
                  <td className="px-3 py-2 border border-gray-200 text-right font-mono">
                    {algo.silhouetteScore != null ? algo.silhouetteScore.toFixed(3) : '—'}
                  </td>
                  <td className="px-3 py-2 border border-gray-200">
                    {algo.success && algo.segments && algo.segments.length > 0 ? (
                      <button
                        onClick={() => setExpandedAlgo(expandedAlgo === algo.algorithmName ? null : algo.algorithmName)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 underline"
                      >
                        {expandedAlgo === algo.algorithmName ? 'Hide' : 'View'} profiles
                      </button>
                    ) : algo.error ? (
                      <span className="text-xs text-red-600 font-mono truncate max-w-[120px] inline-block" title={algo.error}>
                        {algo.error.slice(0, 40)}…
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Expanded Segment Profiles */}
      {expandedAlgo && (() => {
        const algo = algorithms.find((a) => a.algorithmName === expandedAlgo)
        if (!algo?.segments?.length) return null
        return (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
            <h4 className="font-semibold text-sm text-indigo-800 mb-3">{algo.displayName} — Segment Profiles</h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {algo.segments.map((seg) => (
                <div key={seg.id} className="rounded-lg bg-white border border-indigo-100 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{seg.label}</span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{seg.size} records</span>
                  </div>
                  {seg.characteristics.length > 0 && (
                    <ul className="space-y-1">
                      {seg.characteristics.map((c, j) => (
                        <li key={j} className="text-xs text-gray-600 font-mono">• {c}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
