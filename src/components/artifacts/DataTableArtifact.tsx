"use client"

import { useState, useMemo, useCallback } from 'react'
import { FileSpreadsheet, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { AgentArtifact } from '../../types/agent'

interface Props {
  artifact: AgentArtifact
}

const PAGE_SIZE = 25

type SortDir = 'asc' | 'desc' | null

function downloadCSV(rows: Record<string, unknown>[], columns: string[], filename: string) {
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const header = columns.map(escape).join(',')
  const body = rows.map(r => columns.map(c => escape(r[c])).join(',')).join('\n')
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function DataTableArtifact({ artifact }: Props) {
  const rawData = Array.isArray(artifact.data)
    ? (artifact.data as Record<string, unknown>[])
    : []

  const columns = useMemo<string[]>(() => {
    if (rawData.length === 0) return []
    return Object.keys(rawData[0])
  }, [rawData])

  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [page, setPage] = useState(0)

  const handleSort = useCallback(
    (col: string) => {
      if (sortCol === col) {
        setSortDir(prev => (prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc'))
        if (sortDir === 'desc') setSortCol(null)
      } else {
        setSortCol(col)
        setSortDir('asc')
      }
      setPage(0)
    },
    [sortCol, sortDir],
  )

  const sortedData = useMemo(() => {
    if (!sortCol || !sortDir) return rawData
    return [...rawData].sort((a, b) => {
      const av = a[sortCol]
      const bv = b[sortCol]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rawData, sortCol, sortDir])

  const totalPages = Math.ceil(sortedData.length / PAGE_SIZE)
  const pageData = sortedData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col) return <ChevronsUpDown className="inline ml-1 opacity-30" size={12} />
    if (sortDir === 'asc') return <ChevronUp className="inline ml-1" size={12} />
    if (sortDir === 'desc') return <ChevronDown className="inline ml-1" size={12} />
    return <ChevronsUpDown className="inline ml-1 opacity-30" size={12} />
  }

  if (rawData.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
        No data to display.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {sortedData.length.toLocaleString()} rows · {columns.length} columns
        </span>
        <button
          onClick={() => downloadCSV(sortedData, columns, 'export.csv')}
          className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 active:bg-gray-100 transition-colors"
        >
          <FileSpreadsheet size={13} />
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {columns.map(col => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="px-3 py-2.5 text-left font-semibold text-gray-700 whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors"
                >
                  {col}
                  <SortIcon col={col} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, ri) => (
              <tr
                key={ri}
                className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}
              >
                {columns.map(col => (
                  <td
                    key={col}
                    className="px-3 py-2 text-gray-700 border-b border-gray-100 whitespace-nowrap max-w-xs truncate"
                    title={row[col] == null ? '' : String(row[col])}
                  >
                    {row[col] == null ? (
                      <span className="text-gray-300 italic">null</span>
                    ) : (
                      String(row[col])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            {/* Page number pills — show at most 5 */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pg = i
              if (totalPages > 5) {
                const start = Math.max(0, Math.min(page - 2, totalPages - 5))
                pg = start + i
              }
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  className={`rounded px-1.5 py-0.5 transition-colors ${
                    pg === page
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'hover:bg-gray-100'
                  }`}
                >
                  {pg + 1}
                </button>
              )
            })}
            <button
              disabled={page === totalPages - 1}
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
