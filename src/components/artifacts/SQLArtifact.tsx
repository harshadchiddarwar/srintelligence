"use client"

import { useState } from 'react'
import { Copy, Check, ChevronDown, ChevronRight, Play } from 'lucide-react'
import type { AgentArtifact } from '../../types/agent'

interface Props {
  artifact: AgentArtifact
}

function extractSQL(data: unknown): string {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (typeof d.sql === 'string') return d.sql
    if (typeof d.query === 'string') return d.query
  }
  // Fall back to artifact.sql if it's a stub call — handled at call site
  return ''
}

export default function SQLArtifact({ artifact }: Props) {
  const sql = artifact.sql ?? extractSQL(artifact.data)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sql)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available
    }
  }

  const lineCount = sql.split('\n').length

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm">
      {/* Header bar */}
      <div
        className="flex items-center justify-between bg-gray-800 px-3 py-2 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown size={14} className="text-gray-400" />
          ) : (
            <ChevronRight size={14} className="text-gray-400" />
          )}
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            SQL
          </span>
          {!expanded && (
            <span className="text-xs text-gray-500 ml-1">
              {lineCount} line{lineCount !== 1 ? 's' : ''} — click to expand
            </span>
          )}
        </div>

        {/* Action buttons — stop propagation so they don't toggle collapse */}
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            title={copied ? 'Copied!' : 'Copy SQL'}
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Run button stub */}
          <div className="relative">
            <button
              disabled
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 cursor-not-allowed opacity-50"
            >
              <Play size={12} />
              <span>Run</span>
            </button>
            {showTooltip && (
              <div className="absolute bottom-full right-0 mb-1 z-10 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-gray-200 shadow-lg border border-gray-700">
                Open in Snowflake
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SQL body */}
      {expanded && (
        <div className="bg-[#1e1e1e] overflow-x-auto">
          <pre className="px-4 py-4 text-xs text-gray-200 font-mono leading-relaxed whitespace-pre">
            {sql || <span className="italic text-gray-500">No SQL available.</span>}
          </pre>
        </div>
      )}
    </div>
  )
}
