"use client"

import { AlertTriangle, Zap } from 'lucide-react'

interface CostEstimate {
  estimatedCredits: number
  estimatedDurationMs: number
  complexity: 'low' | 'medium' | 'high'
  breakdown: {
    warehouseCredits: number
    analystCredits: number
    llmTokenCost: number
  }
}

interface Props {
  estimate: CostEstimate
  onProceed: () => void
  onCancel: () => void
  /** Current remaining credits for the user — used to determine if shown */
  remainingCredits?: number
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

export default function CostIndicator({ estimate, onProceed, onCancel, remainingCredits }: Props) {
  const isHigh = estimate.complexity === 'high'
  const isLowCredits =
    remainingCredits != null && remainingCredits < estimate.estimatedCredits * 2

  // Only show when complexity is high or credits are tight
  if (!isHigh && !isLowCredits) return null

  const { breakdown } = estimate

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col gap-3 shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-900">
            {isHigh ? 'High-complexity query' : 'Low credit balance'}
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            This operation will consume approximately{' '}
            <span className="font-bold">
              {estimate.estimatedCredits.toFixed(2)} credits
            </span>{' '}
            and take ~{formatDuration(estimate.estimatedDurationMs)}.
            {isLowCredits && remainingCredits != null && (
              <> You have {remainingCredits.toFixed(2)} credits remaining.</>
            )}
          </p>
        </div>
      </div>

      {/* Breakdown table */}
      <div className="rounded-lg border border-amber-200 bg-white overflow-hidden">
        <table className="min-w-full text-xs">
          <tbody>
            <tr className="border-b border-amber-100">
              <td className="px-3 py-1.5 text-gray-600">Warehouse credits</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-800">
                {breakdown.warehouseCredits.toFixed(4)}
              </td>
            </tr>
            <tr className="border-b border-amber-100">
              <td className="px-3 py-1.5 text-gray-600">Analyst credits</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-800">
                {breakdown.analystCredits.toFixed(4)}
              </td>
            </tr>
            <tr>
              <td className="px-3 py-1.5 text-gray-600">LLM token cost</td>
              <td className="px-3 py-1.5 text-right font-mono text-gray-800">
                {breakdown.llmTokenCost.toFixed(4)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="bg-amber-50 border-t border-amber-200">
              <td className="px-3 py-1.5 font-semibold text-gray-800">Total estimate</td>
              <td className="px-3 py-1.5 text-right font-mono font-bold text-amber-900">
                ~{estimate.estimatedCredits.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Complexity badge */}
      <div className="flex items-center gap-1.5">
        <Zap size={12} className="text-amber-600" />
        <span className="text-xs text-amber-700">
          Complexity:{' '}
          <span className="font-semibold capitalize">{estimate.complexity}</span>
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onProceed}
          className="flex-1 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 active:bg-amber-800 transition-colors"
        >
          Proceed anyway
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
