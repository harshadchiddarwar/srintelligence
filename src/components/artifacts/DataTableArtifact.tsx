"use client"

import { useState, useMemo, useCallback } from 'react'
import { FileSpreadsheet, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { AgentArtifact } from '../../types/agent'
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

// ---------------------------------------------------------------------------
// Date string detection
// analyst-agent.ts converts Snowflake epoch-day integers to MM/DD/YY before
// sending data to the UI. Detect that format here to decide whether to plot
// a line chart.
// ---------------------------------------------------------------------------

const MM_DD_YY = /^\d{2}\/\d{2}\/\d{2}$/

function isFormattedDate(v: unknown): boolean {
  return typeof v === 'string' && MM_DD_YY.test(v.trim())
}

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

// ---------------------------------------------------------------------------
// Data normalizer — handles the two shapes AnalystAgent can produce:
//
//   1. Flat array of objects — { col1: val, col2: val }[]
//      (emitted by the v3.0 dispatcher's PATH B named-agent responses, or
//       whenever artifact.data is already in the canonical table format)
//
//   2. Nested result envelope — { results: { headers: string[], rows: unknown[][] } }
//      (emitted by AnalystAgent.execute() which stores the Snowflake SQL result
//       as a { headers, rows } pair so that the SQL is not lost)
// ---------------------------------------------------------------------------

function normalizeRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    // Shape 1: plain array — use directly
    return data as Record<string, unknown>[]
  }

  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>

    // Shape 2: { results: { headers, rows } }
    const results = d['results'] as
      | { headers?: string[]; rows?: unknown[][] }
      | undefined

    if (Array.isArray(results?.headers) && Array.isArray(results?.rows)) {
      const headers = results.headers as string[]
      return (results.rows as unknown[][]).map((row) =>
        Object.fromEntries(headers.map((h, i) => [h, row[i] ?? null])),
      )
    }

    // Shape 3: sometimes named agents return { rows: Record<string,unknown>[] }
    if (Array.isArray(d['rows'])) {
      const rows = d['rows'] as unknown[]
      if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
        return rows as Record<string, unknown>[]
      }
    }
  }

  return []
}

export default function DataTableArtifact({ artifact }: Props) {
  const rawData = normalizeRows(artifact.data)

  const columns = useMemo<string[]>(() => {
    if (rawData.length === 0) return []
    return Object.keys(rawData[0])
  }, [rawData])

  // Detect whether first column contains MM/DD/YY date strings (pre-formatted
  // by analyst-agent.ts) and remaining columns are numeric → show a line chart.
  const firstCol = columns[0] ?? ''
  const isTemporalData = useMemo(() => {
    if (rawData.length < 2) return false
    const sample = rawData.slice(0, 10)
    const hits = sample.filter((r) => isFormattedDate(r[firstCol])).length
    return hits / sample.length >= 0.8
  }, [rawData, firstCol])

  const numericCols = useMemo(
    () =>
      columns.slice(1).filter((col) =>
        rawData.slice(0, 5).every((r) => {
          const v = r[col]
          if (typeof v === 'number') return true
          if (typeof v === 'string' && v.trim() !== '') return !isNaN(Number(v.replace(/,/g, '')))
          return false
        }),
      ),
    [rawData, columns],
  )

  // Chart data — dates already formatted, coerce numeric values and sort chronologically
  const chartData = useMemo(() => {
    if (!isTemporalData || numericCols.length === 0) return []
    const mapped = rawData.map((row) => {
      const dateStr = String(row[firstCol] ?? '')
      // Parse MM/DD/YY → sortable number (YYYYMMDD)
      const [mm, dd, yy] = dateStr.split('/')
      const sortKey = yy && mm && dd ? parseInt(`20${yy}${mm}${dd}`, 10) : 0
      const entry: Record<string, string | number> = { date: dateStr, _sortKey: sortKey }
      for (const col of numericCols) {
        const v = row[col]
        entry[col] = typeof v === 'number' ? v : Number(String(v ?? '0').replace(/,/g, ''))
      }
      return entry
    })
    // Sort ascending by date so the line flows left → right in time
    mapped.sort((a, b) => (a._sortKey as number) - (b._sortKey as number))
    // Remove the internal sort key before passing to Recharts
    return mapped.map(({ _sortKey: _sk, ...rest }) => rest)
  }, [isTemporalData, rawData, firstCol, numericCols])

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

  const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4']

  return (
    <div className="flex flex-col gap-3">
      {/* Line chart for temporal + numeric data */}
      {isTemporalData && chartData.length > 0 && numericCols.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                angle={-35}
                textAnchor="end"
                height={48}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v: number) =>
                  v >= 1_000_000
                    ? `${(v / 1_000_000).toFixed(1)}M`
                    : v >= 1_000
                    ? `${(v / 1_000).toFixed(0)}K`
                    : String(v)
                }
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  value.toLocaleString(),
                  name,
                ]}
              />
              {numericCols.map((col, i) => (
                <Line
                  key={col}
                  type="monotone"
                  dataKey={col}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={chartData.length <= 60}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

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
    </div>
  )
}
