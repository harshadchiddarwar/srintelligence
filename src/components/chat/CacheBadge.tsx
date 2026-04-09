"use client"

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

interface Props {
  cacheStatus?: 'hit' | 'miss' | 'bypass'
}

const CONFIG = {
  hit: {
    label: '⚡ Cached',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    tooltip: 'Result served from cache.',
  },
  miss: {
    label: '🔄 Fresh',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    tooltip: 'Fresh result — not in cache.',
  },
  bypass: {
    label: '⏭ Bypassed',
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-500',
    tooltip: 'Cache was bypassed for this query.',
  },
}

export default function CacheBadge({ cacheStatus }: Props) {
  const [showTooltip, setShowTooltip] = useState(false)

  if (!cacheStatus) return null

  const cfg = CONFIG[cacheStatus]

  return (
    <div className="relative inline-block">
      <span
        className={`inline-flex cursor-default items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.border} ${cfg.text}`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        tabIndex={0}
      >
        {cfg.label}
      </span>

      {showTooltip && (
        <div className="absolute bottom-full left-0 mb-1.5 z-50 w-56 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
          <p className="text-xs text-gray-700 mb-1.5">{cfg.tooltip}</p>
          <a
            href="?refresh=true"
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
            onClick={e => e.stopPropagation()}
          >
            <RefreshCw size={10} />
            Refresh (bypass cache)
          </a>
        </div>
      )}
    </div>
  )
}
