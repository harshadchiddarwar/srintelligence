"use client"

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react'

interface RateLimitData {
  queriesUsed: number
  queriesLimit: number
  creditsUsed: number
  creditsLimit: number
  windowResetsAt?: number
}

interface Props {
  userId: string
}

function colorClass(used: number, limit: number): string {
  if (limit === 0) return 'text-gray-500'
  const pct = used / limit
  if (pct >= 0.8) return 'text-red-600'
  if (pct >= 0.5) return 'text-amber-600'
  return 'text-green-600'
}

function barColor(used: number, limit: number): string {
  if (limit === 0) return 'bg-gray-300'
  const pct = used / limit
  if (pct >= 0.8) return 'bg-red-500'
  if (pct >= 0.5) return 'bg-amber-500'
  return 'bg-green-500'
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  return (
    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${barColor(used, limit)}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function RateLimitBar({ userId }: Props) {
  const [data, setData] = useState<RateLimitData | null>(null)
  const [expanded, setExpanded] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/user/rate-limit')
      if (!res.ok) return
      const json = await res.json()
      setData(json)
    } catch {
      // Silently ignore
    }
  }, [userId])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 60_000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (!data) return null

  const { queriesUsed, queriesLimit, creditsUsed, creditsLimit } = data

  const qColor = colorClass(queriesUsed, queriesLimit)
  const cColor = colorClass(creditsUsed, creditsLimit)

  const resetsIn = data.windowResetsAt
    ? Math.max(0, Math.round((data.windowResetsAt - Date.now()) / 60000))
    : null

  return (
    <div className="relative">
      {/* Compact bar */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs shadow-sm hover:bg-gray-50 transition-colors"
        title="Rate limit status — click for details"
      >
        <span className={qColor}>
          <span className="font-semibold">{queriesUsed}</span>
          <span className="text-gray-400">/{queriesLimit}</span>
          <span className="text-gray-500 ml-0.5">queries</span>
        </span>
        <span className="text-gray-300">·</span>
        <span className={cColor}>
          <span className="font-semibold">{creditsUsed.toFixed(1)}</span>
          <span className="text-gray-400">/{creditsLimit}</span>
          <span className="text-gray-500 ml-0.5">credits</span>
        </span>
        {expanded ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
      </button>

      {/* Expanded dropdown */}
      {expanded && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setExpanded(false)} />
          <div className="absolute right-0 top-full mt-1.5 z-20 w-64 rounded-xl border border-gray-200 bg-white p-4 shadow-xl flex flex-col gap-3">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-wider">Usage — current window</p>

            {/* Queries */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">Queries</span>
                <span className={`font-semibold ${qColor}`}>
                  {queriesUsed} / {queriesLimit}
                </span>
              </div>
              <UsageBar used={queriesUsed} limit={queriesLimit} />
            </div>

            {/* Credits */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">Credits</span>
                <span className={`font-semibold ${cColor}`}>
                  {creditsUsed.toFixed(2)} / {creditsLimit}
                </span>
              </div>
              <UsageBar used={creditsUsed} limit={creditsLimit} />
            </div>

            {resetsIn != null && (
              <p className="text-xs text-gray-400">
                Window resets in ~{resetsIn} minute{resetsIn !== 1 ? 's' : ''}
              </p>
            )}

            {/* Refresh link */}
            <button
              onClick={async () => { await fetchData(); setExpanded(false) }}
              className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              <RotateCcw size={11} />
              Refresh
            </button>
          </div>
        </>
      )}
    </div>
  )
}
