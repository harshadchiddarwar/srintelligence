"use client"

import { useState } from 'react'
import { Link, X, Loader2 } from 'lucide-react'
import LineageGraph from '../lineage/LineageGraph'
import type { LineageRecord } from '../../types/user'

interface Props {
  lineageId?: string
}

export default function LineageLink({ lineageId }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [chain, setChain] = useState<LineageRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!lineageId) return null

  const handleOpen = async () => {
    setOpen(true)
    if (chain) return // already fetched

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/lineage/${lineageId}/chain`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setChain(Array.isArray(data) ? data : data.chain ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load lineage')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Trigger link */}
      <button
        onClick={handleOpen}
        className="flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
      >
        <Link size={11} />
        Lineage
      </button>

      {/* Slide-over panel */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-md bg-white shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">Execution Lineage</p>
                <p className="text-xs text-gray-500 font-mono mt-0.5 truncate max-w-64">
                  {lineageId}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-12 text-gray-400">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-sm">Loading lineage…</span>
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {chain && chain.length > 0 && (
                <LineageGraph chain={chain} />
              )}

              {chain && chain.length === 0 && !loading && (
                <p className="text-sm text-gray-400 italic text-center py-8">
                  No lineage records found.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
