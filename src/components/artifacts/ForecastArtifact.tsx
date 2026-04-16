"use client"

import React, { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Download, Maximize2, X } from 'lucide-react'
import type { AgentArtifact } from '../../types/agent'
import {
  ComposedChart,
  Line,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'

// ---------------------------------------------------------------------------
// Data interfaces
// ---------------------------------------------------------------------------

interface ForecastRow {
  date?: string
  week?: string
  ds?: string
  period?: string
  // actuals
  actuals?: number
  actual?: number
  value?: number
  y?: number
  // predicted
  predicted?: number
  forecast?: number
  yhat?: number
  // confidence interval
  lower?: number
  upper?: number
  lower_bound?: number
  upper_bound?: number
  ci_lower?: number
  ci_upper?: number
  yhat_lower?: number
  yhat_upper?: number
  // holiday
  holiday?: string
  holiday_name?: string
  is_holiday?: string | boolean
  // validation
  errorPct?: number
  error_pct?: number
  error_percentage?: number
}

interface ForecastMetrics {
  mape?: number
  mae?: number
  model?: string
  horizon?: number
  reliability?: string
  // training / validation date ranges
  trainStart?: string
  trainEnd?: string
  valStart?: string
  valEnd?: string
  trainedOn?: string
  validatedOn?: string
  train_start?: string
  train_end?: string
  val_start?: string
  val_end?: string
}

/** One cluster's forecast data (used in per-cluster multi-line chart mode) */
interface ClusterForecast {
  clusterId: number
  clusterName: string
  historical?: ForecastRow[]
  forecast?: ForecastRow[]
  validation?: ForecastRow[]
  metrics?: ForecastMetrics
  /** One-sentence summary for this cluster (e.g. "declining 3.1% over 13 weeks") */
  summary?: string
  /** Cluster-specific model notes / caveats */
  notes?: string[]
}

interface ForecastData {
  historical?: ForecastRow[]
  forecast?: ForecastRow[]
  validation?: ForecastRow[]
  metrics?: ForecastMetrics
  modelNotes?: string[]
  model_notes?: string[]
  notes?: string[]
  insights?: string[]
  summary?: string
  /** Present when the agent returned per-cluster forecasts (multi-line chart mode) */
  clusters?: ClusterForecast[]
  /** Notes common to all clusters (e.g. model methodology) */
  commonNotes?: string[]
  /** Overall summary across all clusters */
  overallSummary?: string
}

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

/** Pick first truthy value from a list of candidate keys on an object */
function pick<T>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (v != null) return v as T
  }
  return undefined
}

function normaliseDate(row: ForecastRow): string {
  return (
    pick<string>(row as unknown as Record<string, unknown>, [
      'date', 'week', 'ds', 'DS', 'period',
    ]) ?? ''
  )
}

function normaliseActuals(row: ForecastRow): number | undefined {
  return pick<number>(row as unknown as Record<string, unknown>, [
    'actuals', 'actual', 'y', 'Y',
  ])
}

function normalisePredicted(row: ForecastRow): number | undefined {
  return pick<number>(row as unknown as Record<string, unknown>, [
    'predicted', 'forecast', 'yhat', 'YHAT', 'value',
  ])
}

function normaliseLower(row: ForecastRow): number | undefined {
  return pick<number>(row as unknown as Record<string, unknown>, [
    'lower', 'lower_bound', 'ci_lower', 'yhat_lower', 'YHAT_LOWER',
  ])
}

function normaliseUpper(row: ForecastRow): number | undefined {
  return pick<number>(row as unknown as Record<string, unknown>, [
    'upper', 'upper_bound', 'ci_upper', 'yhat_upper', 'YHAT_UPPER',
  ])
}

function normaliseHoliday(row: ForecastRow): string {
  const v = pick<string | boolean>(row as unknown as Record<string, unknown>, [
    'holiday', 'holiday_name', 'is_holiday',
  ])
  if (!v) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : ''
  return v
}

function normaliseErrorPct(row: ForecastRow): number | undefined {
  return pick<number>(row as unknown as Record<string, unknown>, [
    'errorPct', 'error_pct', 'error_percentage',
  ])
}

function normaliseStringArray(
  data: ForecastData,
  keys: Array<keyof ForecastData>,
): string[] {
  for (const k of keys) {
    const v = data[k]
    if (Array.isArray(v) && v.length > 0) return v as string[]
  }
  return []
}

// ---------------------------------------------------------------------------
// Narrative parser — converts Snowflake agent markdown text → ForecastData
// Used when artifact.data is null (named agent returns text-only response)
// ---------------------------------------------------------------------------

function stripNum(s: string): number | undefined {
  const n = Number(s.replace(/,/g, '').replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? undefined : n
}

/** Parse a markdown table block into an array of {header: value} objects */
function parseMarkdownTable(block: string): Record<string, string>[] {
  const lines = block.split('\n').map(l => l.trim()).filter(l => l.startsWith('|'))
  if (lines.length < 2) return []
  const headers = lines[0].split('|').map(h => h.trim()).filter(Boolean)
  const rows: Record<string, string>[] = []
  for (const line of lines.slice(2)) { // skip header + separator
    const cells = line.split('|').map(c => c.trim()).filter(c => c !== '')
    if (cells.length < 2) continue
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = cells[i] ?? '' })
    rows.push(row)
  }
  return rows
}

/** Extract all markdown table blocks from text */
function extractTables(text: string): string[] {
  const tables: string[] = []
  const lines = text.split('\n')
  let current: string[] = []
  for (const line of lines) {
    if (line.trim().startsWith('|')) {
      current.push(line)
    } else if (current.length > 0) {
      tables.push(current.join('\n'))
      current = []
    }
  }
  if (current.length > 0) tables.push(current.join('\n'))
  return tables
}

/** Extract bullet-point lines from a named section */
function extractSectionBullets(text: string, sectionPattern: RegExp): string[] {
  const match = text.match(sectionPattern)
  if (!match) return []
  const start = text.indexOf(match[0]) + match[0].length
  const rest = text.slice(start)
  // Collect until next ## heading or end
  const end = rest.search(/\n#{1,3} /)
  const section = end >= 0 ? rest.slice(0, end) : rest
  return section
    .split('\n')
    // Strip leading list markers (- or single * or •) but preserve **bold** opening markers
    .map(l => l.replace(/^[\s]*[-•]\s+|^[\s]*\*(?!\*)\s+/, '').trim())
    .filter(l => l.length > 10)
}

// ---------------------------------------------------------------------------
// Shared table-row parsers (used by both single and per-cluster parsing)
// ---------------------------------------------------------------------------

function parseValidationRows(rows: Record<string, string>[]): ForecastRow[] {
  return rows.map(r => {
    const dateKey = Object.keys(r).find(k => /week|date|period/i.test(k)) ?? Object.keys(r)[0]
    const actualKey = Object.keys(r).find(k => /actual/i.test(k)) ?? ''
    const predKey = Object.keys(r).find(k => /predict/i.test(k)) ?? ''
    const errKey = Object.keys(r).find(k => /error/i.test(k)) ?? ''
    const rawDate = r[dateKey]?.replace(/\*/g, '').trim() ?? ''
    const errStr = r[errKey]?.replace(/%/g, '').trim()
    return {
      date: rawDate,
      actuals: stripNum(r[actualKey] ?? ''),
      predicted: stripNum(r[predKey] ?? ''),
      errorPct: errStr ? parseFloat(errStr) : undefined,
    } as ForecastRow
  })
}

function parseForecastRows(rows: Record<string, string>[]): ForecastRow[] {
  return rows.map(r => {
    const dateKey = Object.keys(r).find(k => /week|date|period/i.test(k)) ?? Object.keys(r)[0]
    const predKey = Object.keys(r).find(k => /predict|forecast/i.test(k)) ?? ''
    const lowerKey = Object.keys(r).find(k => /lower|ci.low|80.*low/i.test(k)) ?? ''
    const upperKey = Object.keys(r).find(k => /upper|ci.up|80.*up/i.test(k)) ?? ''
    const ciKey = !lowerKey ? (Object.keys(r).find(k => /confidence|range|ci|interval/i.test(k)) ?? '') : ''
    const holKey = Object.keys(r).find(k => /holiday/i.test(k)) ?? ''
    const rawDate = r[dateKey]?.replace(/\*/g, '').trim() ?? ''
    // Prefer separate lower/upper columns; fall back to combined "CI Lower – CI Upper" cell
    let lower: number | undefined, upper: number | undefined
    if (lowerKey && upperKey) {
      lower = stripNum(r[lowerKey] ?? '')
      upper = stripNum(r[upperKey] ?? '')
    } else if (ciKey) {
      const ciRaw = r[ciKey] ?? ''
      const ciParts = ciRaw.split(/\s*[–—\-]\s*/).map(s => stripNum(s))
      lower = ciParts[0]; upper = ciParts[1]
    }
    return {
      date: rawDate,
      predicted: stripNum(r[predKey] ?? ''),
      lower,
      upper,
      holiday: r[holKey]?.trim() || undefined,
    } as ForecastRow
  })
}

function classifyTableRows(rows: Record<string, string>[]): 'validation' | 'forecast' | 'other' {
  if (rows.length === 0) return 'other'
  const keys = Object.keys(rows[0]).map(k => k.toLowerCase())
  const hasError = keys.some(k => k.includes('error'))
  const hasActual = keys.some(k => k.includes('actual'))
  const hasForecast = keys.some(k =>
    k.includes('predicted') || k.includes('forecast') || k.includes('confidence') || k.includes('ci')
  )
  if (hasActual && hasError) return 'validation'
  if (hasForecast) return 'forecast'
  return 'other'
}

export function parseForecastNarrative(text: string): ForecastData {
  if (!text) return {}

  // ── Detect per-cluster sections ("### Cluster N — Label") ─────────────────
  // The SRI_FORECAST_AGENT returns one section per cluster when given a
  // CLUSTER FORECAST INSTRUCTION.  Each section starts with a heading like:
  //   "### Cluster 0 — Low Volume Physicians"
  // We split on those headings and parse each independently.
  const CLUSTER_SECTION_RE = /###\s+Cluster\s+(\d+)[^\n]*/gi
  const clusterMatches = [...text.matchAll(CLUSTER_SECTION_RE)]

  if (clusterMatches.length >= 2) {
    // Multi-cluster mode
    const clusters: ClusterForecast[] = []
    for (let i = 0; i < clusterMatches.length; i++) {
      const match = clusterMatches[i]
      const clusterId = parseInt(match[1])
      const clusterName = match[0].replace(/^###\s+/, '').trim()
      const sectionStart = (match.index ?? 0) + match[0].length
      const sectionEnd = i + 1 < clusterMatches.length
        ? (clusterMatches[i + 1].index ?? text.length)
        : text.length
      const sectionText = text.slice(sectionStart, sectionEnd)

      // Parse tables within this cluster section
      const sectionTables = extractTables(sectionText)
      let valRows: ForecastRow[] = []
      let fcRows: ForecastRow[] = []

      for (const tbl of sectionTables) {
        const rows = parseMarkdownTable(tbl)
        if (rows.length === 0) continue
        const kind = classifyTableRows(rows)
        if (kind === 'validation') valRows = parseValidationRows(rows)
        else if (kind === 'forecast') fcRows = parseForecastRows(rows)
      }

      // Extract per-cluster MAPE/MAE from the section text
      const mapeM = sectionText.match(/MAPE[^0-9]*([0-9]+\.?[0-9]*)\s*%/i)
      const maeM  = sectionText.match(/MAE[^0-9]*([0-9,]+)/i)

      // Training / validation periods
      const trainM = sectionText.match(/\*{0,2}[Tt]rained?\s+on\*{0,2}[^:]*:\s*\*{0,2}([^\n*]+)/)?.[1]?.trim()
        ?? sectionText.match(/[Tt]raining\s+(?:period|data)[^:]*:\s*([^\n]+)/)?.[1]?.trim()
      const valM = sectionText.match(/\*{0,2}[Vv]alidat\w+\s+on\*{0,2}[^:]*:\s*\*{0,2}([^\n*]+)/)?.[1]?.trim()
        ?? sectionText.match(/[Vv]alidat\w+\s+(?:period|set)[^:]*:\s*([^\n]+)/)?.[1]?.trim()

      // Per-cluster one-line summary (look for "Key trend:", last standalone sentence, etc.)
      const summaryM = sectionText.match(
        /\*{0,2}(?:Key\s+)?(?:[Tt]rend|[Ss]ummary|[Ii]nsight)[^:*]*[:*]+\s*\*{0,2}([^\n]{15,})/
      )?.[1]?.replace(/\*+/g, '').trim()
        ?? sectionText.match(
          /(?:The\s+(?:model|forecast)\s+(?:projects?|shows?|predicts?|indicates?)[^.]{15,}\.)/
        )?.[0]?.trim()

      // Cluster-specific notes (look for #### Notes or #### Caveats sub-heading)
      const clusterNotes = extractSectionBullets(
        sectionText,
        /#{1,4}\s*(?:Model\s+)?(?:Notes|Caveats|Observations)/i,
      )

      const metrics: ForecastMetrics = {
        mape: mapeM ? parseFloat(mapeM[1]) : undefined,
        mae:  maeM  ? stripNum(maeM[1])    : undefined,
        trainedOn: trainM,
        validatedOn: valM,
      }

      clusters.push({
        clusterId,
        clusterName,
        validation: valRows.length > 0 ? valRows : undefined,
        forecast:   fcRows.length > 0  ? fcRows  : undefined,
        metrics,
        summary: summaryM,
        notes: clusterNotes.length > 0 ? clusterNotes : undefined,
      })
    }

    if (clusters.some(c => c.forecast && c.forecast.length > 0)) {
      // Extract common notes and overall summary from text outside cluster sections
      const firstClusterIdx = clusterMatches[0].index ?? 0
      const preamble = text.slice(0, firstClusterIdx)
      // Text after all cluster sections (epilogue may have model notes)
      const lastMatch = clusterMatches[clusterMatches.length - 1]
      const lastSectionStart = (lastMatch.index ?? 0) + lastMatch[0].length
      const epilogue = text.slice(lastSectionStart + (text.slice(lastSectionStart).indexOf('\n\n## ') >= 0
        ? text.slice(lastSectionStart).indexOf('\n\n## ')
        : text.length - lastSectionStart))

      const commonNotes = extractSectionBullets(
        text,
        /^#{1,3}\s*(?:Common\s+)?Model\s+Notes?\b/im,
      )

      const overallSummaryM =
        preamble.match(/[Ss]ummary[^:]*:\s*([^\n]{20,})/)?.[1]?.trim()
        ?? preamble.match(/(?:The\s+(?:overall|full|cohort)[^.]{10,}\.)/)?.[0]?.trim()
        ?? (preamble.trim().length > 30 ? preamble.trim().split(/\n\n/)[0]?.trim() : undefined)

      return {
        clusters,
        commonNotes: commonNotes.length > 0 ? commonNotes : undefined,
        overallSummary: overallSummaryM,
      }
    }
    // If we got sections but no forecast rows, fall through to single-cluster parsing
  }

  // ── Single-cluster parsing (original logic) ────────────────────────────────
  const mapeMatch = text.match(/MAPE[^0-9]*([0-9]+\.?[0-9]*)\s*%/i)
  const mape = mapeMatch ? parseFloat(mapeMatch[1]) : undefined

  const maeMatch = text.match(/MAE[^0-9]*([0-9,]+)/i)
  const mae = maeMatch ? stripNum(maeMatch[1]) : undefined

  const trainMatch = text.match(/[Tt]rained on[^(]*\(([^)]+)\)/)?.[1]
    ?? text.match(/[Tt]rained on[^,\n]*/)?.[0]
  const valMatch = text.match(/validated on ([^.(,\n]+)/i)?.[1]

  const trainedOn = trainMatch?.replace(/[Tt]rained on\s*/i, '').trim()
  const validatedOn = valMatch?.replace(/\*\*/g, '').trim()

  const modelMatch = text.match(/##\s+[^\n]+—\s*([^\n(]+)/)?.[1]?.trim()

  const tables = extractTables(text)
  let validationRows: ForecastRow[] = []
  let forecastRows: ForecastRow[] = []

  for (const tableBlock of tables) {
    const rows = parseMarkdownTable(tableBlock)
    if (rows.length === 0) continue
    const kind = classifyTableRows(rows)
    if (kind === 'validation') validationRows = parseValidationRows(rows)
    else if (kind === 'forecast') forecastRows = parseForecastRows(rows)
  }

  const summaryMatch = text.match(/Summary:\s*([^\n]+)/i)
  const summary = summaryMatch?.[1]?.trim().replace(/^\*{1,2}\s+/, '')

  const modelNotes = extractSectionBullets(text, /###\s*(Model.Specific Caveats|Model Notes|Notes|Caveats)/i)

  const insights: string[] = []
  if (mape != null) {
    const acc = mape < 10 ? 'high' : mape < 20 ? 'moderate' : 'low'
    insights.push(`Model achieved ${acc} accuracy with a MAPE of ${mape.toFixed(2)}% on the validation period.`)
  }
  if (mae != null) {
    insights.push(`Mean absolute error (MAE): ${mae.toLocaleString()} units.`)
  }

  return {
    forecast: forecastRows.length > 0 ? forecastRows : undefined,
    validation: validationRows.length > 0 ? validationRows : undefined,
    metrics: {
      mape,
      mae,
      model: modelMatch,
      trainedOn,
      validatedOn,
    },
    modelNotes: modelNotes.length > 0 ? modelNotes : undefined,
    insights: insights.length > 0 ? insights : undefined,
    summary,
  }
}

// ---------------------------------------------------------------------------
// Reliability helpers
// ---------------------------------------------------------------------------

function reliabilityLabel(mape?: number): { label: string; classes: string } {
  if (mape == null) return { label: 'Unknown', classes: 'bg-gray-100 text-gray-600 border-gray-200' }
  if (mape < 10) return { label: 'High', classes: 'bg-green-100 text-green-800 border-green-200' }
  if (mape < 20) return { label: 'Moderate', classes: 'bg-yellow-100 text-yellow-800 border-yellow-200' }
  return { label: 'Low', classes: 'bg-red-100 text-red-800 border-red-200' }
}

// ---------------------------------------------------------------------------
// Date sort key — handles ISO strings (YYYY-MM-DD), MM/DD/YY, and plain
// numeric epoch-day strings.  Returns a comparable integer so rows sort
// oldest → newest.
// ---------------------------------------------------------------------------

function dateKey(dateStr: string): number {
  if (!dateStr) return 0

  // ISO / YYYY-MM-DD or YYYY-MM (e.g. "2024-03-15", "2024-03")
  if (/^\d{4}-\d{2}/.test(dateStr)) {
    return new Date(dateStr).getTime()
  }

  // MM/DD/YY or MM/DD/YYYY  (e.g. "03/15/24", "03/15/2024")
  const mmddyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (mmddyy) {
    const [, mm, dd, yy] = mmddyy
    const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10)
    return new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10)).getTime()
  }

  // Snowflake epoch-day integer string (e.g. "19723")
  const epochDay = Number(dateStr)
  if (!isNaN(epochDay) && epochDay > 0 && epochDay < 100_000) {
    return epochDay * 86_400_000
  }

  // Fallback: let JS parse whatever it can
  const t = Date.parse(dateStr)
  return isNaN(t) ? 0 : t
}

function sortByDate(rows: ForecastRow[]): ForecastRow[] {
  return [...rows].sort((a, b) => dateKey(normaliseDate(a)) - dateKey(normaliseDate(b)))
}

function reliabilityDescription(mape?: number): string {
  if (mape == null) return 'Reliability could not be determined.'
  if (mape < 10) return 'Forecasts are highly reliable — typical error is under 10%.'
  if (mape < 15) return 'Forecasts are reliable for planning purposes — typical error is 10–15%.'
  if (mape < 20) return 'Forecasts have moderate reliability — use alongside qualitative judgment.'
  return 'Forecasts have low reliability — treat as directional guidance only.'
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

/** Export a CSV string and trigger a browser download */
function downloadCSV(headers: string[], rows: (string | number | undefined)[][], filename: string) {
  const escape = (v: string | number | undefined) =>
    v == null ? '' : `"${String(v).replace(/"/g, '""')}"`
  const csv = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

/** Export the recharts SVG inside a ref container to PNG inside a PPTX slide */
async function exportChartToPptx(
  containerRef: React.RefObject<HTMLDivElement | null>,
  title: string,
) {
  const svg = containerRef.current?.querySelector('svg')
  if (!svg) return
  // Serialise SVG → Blob URL
  const svgData = new XMLSerializer().serializeToString(svg)
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  // Dynamic import to avoid SSR issues
  const pptxgen = (await import('pptxgenjs')).default
  const pptx = new pptxgen()
  const slide = pptx.addSlide()
  slide.addText(title, { x: 0.5, y: 0.2, fontSize: 16, bold: true, color: '1f2937' })
  slide.addImage({ path: url, x: 0.5, y: 0.8, w: 9, h: 4.5 })
  await pptx.writeFile({ fileName: `${title.replace(/[^a-z0-9]/gi, '_')}.pptx` })
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 border-b border-gray-200 pb-1.5 mb-3">
      {children}
    </h3>
  )
}

function DownloadButton({
  onClick,
  label,
  title,
}: {
  onClick: () => void
  label: string
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors border border-gray-200"
    >
      <Download size={11} />
      {label}
    </button>
  )
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string
  value: React.ReactNode
  sub?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 min-w-[100px]">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      <span className="text-base font-bold text-gray-900 leading-tight">{value}</span>
      {sub && <span className="text-[10px] text-gray-400 leading-snug">{sub}</span>}
    </div>
  )
}

/** Render inline markdown: **bold** and _italic_. Strips orphaned unmatched ** markers. */
function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    // Strip any remaining unmatched ** or _ markers from plain text segments
    return part.replace(/\*\*/g, '').replace(/(?<!\w)_(?!\w)/g, '')
  })
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <ul className="space-y-1.5 list-none p-0 m-0">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-relaxed">
          <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-gray-400 flex-shrink-0" />
          <span className="flex-1 min-w-0">{renderInlineMarkdown(item)}</span>
        </li>
      ))}
    </ul>
  )
}

function FullscreenOverlay({
  title,
  onClose,
  children,
  actions,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <div className="flex items-center gap-2">
          {actions}
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded hover:bg-gray-200 transition-colors text-gray-500"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      {/* Body */}
      <div className="flex-1 overflow-auto p-5">
        {children}
      </div>
    </div>,
    document.body,
  )
}

function CollapsibleTable({
  title,
  children,
  onDownloadCSV,
  onFullscreen,
}: {
  title: string
  children: React.ReactNode
  onDownloadCSV?: () => void
  onFullscreen?: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center bg-gray-50 border-b border-gray-200">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex-1 flex items-center gap-2 px-3 py-2.5 hover:bg-gray-100 transition-colors text-left"
        >
          <span className="text-xs font-bold uppercase tracking-widest text-gray-500">{title}</span>
          <span className="text-gray-400 flex-shrink-0">
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </span>
        </button>
        <div className="flex items-center gap-1 px-2">
          {onDownloadCSV && (
            <DownloadButton onClick={onDownloadCSV} label="CSV" title="Download as CSV" />
          )}
          {onFullscreen && (
            <button
              onClick={onFullscreen}
              title="Full screen"
              className="flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors"
            >
              <Maximize2 size={12} />
            </button>
          )}
        </div>
      </div>
      {!collapsed && <div className="overflow-x-auto max-h-72 overflow-y-auto">{children}</div>}
    </div>
  )
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ color: string; name: string; value: number | null }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload
        .filter(p => p.value != null)
        .map(p => (
          <p key={p.name} style={{ color: p.color === 'transparent' ? '#9ca3af' : p.color }}>
            {p.name}:{' '}
            {typeof p.value === 'number'
              ? p.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : p.value}
          </p>
        ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Multi-cluster line chart (no CI)
// ---------------------------------------------------------------------------

// Fixed palette — one colour per cluster (up to 8)
const CLUSTER_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
]

// ---------------------------------------------------------------------------
// Multi-cluster full report (5 sections)
// ---------------------------------------------------------------------------

function MultiClusterReport({
  clusters,
  commonNotes,
  overallSummary,
}: {
  clusters: ClusterForecast[]
  commonNotes?: string[]
  overallSummary?: string
}) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [chartFullscreen, setChartFullscreen] = useState(false)

  const fmt = (v: number | undefined) =>
    v != null ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'

  // ── Unified sorted date timeline ─────────────────────────────────────────
  const allDates = Array.from(new Set(
    clusters.flatMap(c => [
      ...(c.validation ?? []).map(r => normaliseDate(r)),
      ...(c.forecast   ?? []).map(r => normaliseDate(r)),
    ]).filter(Boolean),
  )).sort((a, b) => dateKey(a) - dateKey(b))

  // ── Chart data: one row per date, per-cluster actuals + forecast keys ─────
  const chartData = allDates.map(date => {
    const point: Record<string, string | number | undefined> = { date }
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i]
      const vr = c.validation?.find(r => normaliseDate(r) === date)
      const fr = c.forecast?.find(r => normaliseDate(r) === date)
      point[`c${i}_act`] = vr ? (normaliseActuals(vr) ?? normalisePredicted(vr)) : undefined
      point[`c${i}_fc`]  = fr ? normalisePredicted(fr) : undefined
    }
    return point
  })

  // Last validation date = vertical separator
  const lastActualDate = clusters
    .flatMap(c => c.validation ?? [])
    .map(r => normaliseDate(r))
    .filter(Boolean)
    .sort((a, b) => dateKey(a) - dateKey(b))
    .at(-1)

  const CHART_HEIGHT   = 300
  const CHART_MIN_W    = 700
  const scrollWidth    = Math.max(CHART_MIN_W, allDates.length * 16)

  // ── Forecast table: all dates × clusters ─────────────────────────────────
  const tableRows = allDates.map(date => {
    const row: Record<string, number | string | undefined> = { date }
    let anyAct = false
    for (let i = 0; i < clusters.length; i++) {
      const c   = clusters[i]
      const vr  = c.validation?.find(r => normaliseDate(r) === date)
      const fr  = c.forecast?.find(r => normaliseDate(r) === date)
      const act = vr ? normaliseActuals(vr) : undefined
      const pred = vr ? normalisePredicted(vr) : fr ? normalisePredicted(fr) : undefined
      row[`c${i}_act`]  = act
      row[`c${i}_pred`] = pred
      if (act != null) anyAct = true
    }
    row._isForecast = anyAct ? undefined : 'yes'
    return row
  })

  const downloadTableCSV = () => {
    const headers = [
      'Week',
      ...clusters.flatMap(c => {
        const n = c.clusterName.replace(/^###\s*/, '')
        return [`${n} Actuals`, `${n} Predicted`]
      }),
    ]
    const rows = tableRows.map(r => [
      r.date,
      ...clusters.flatMap((_, i) => [r[`c${i}_act`], r[`c${i}_pred`]]),
    ])
    downloadCSV(headers, rows as (string | number | undefined)[][], 'cluster_forecast.csv')
  }

  // ── Chart body (reused in normal + fullscreen) ────────────────────────────
  const renderChart = (height: number, width: number) => (
    <div ref={chartRef} style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: width, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 24, bottom: 40, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#6b7280' }}
              angle={-35}
              textAnchor="end"
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#6b7280' }}
              tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
              width={56}
            />
            <Tooltip
              formatter={(value: unknown, name: unknown) => [
                value != null ? Number(value).toLocaleString() : '—', String(name ?? '')
              ]}
              labelStyle={{ fontSize: 11 }}
              contentStyle={{ fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />

            {/* Background shading: actuals region (blue) + forecast region (green) */}
            {lastActualDate && chartData.length > 1 && (
              <>
                <ReferenceArea
                  x1={chartData[0].date as string}
                  x2={lastActualDate}
                  fill="#eff6ff"
                  fillOpacity={0.45}
                />
                <ReferenceArea
                  x1={lastActualDate}
                  x2={chartData[chartData.length - 1].date as string}
                  fill="#f0fdf4"
                  fillOpacity={0.45}
                />
              </>
            )}

            {/* Vertical dashed separator */}
            {lastActualDate && (
              <ReferenceLine
                x={lastActualDate}
                stroke="#9ca3af"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{ value: '← Actuals  |  Forecast →', position: 'insideTop', fontSize: 10, fill: '#6b7280', dy: -2 }}
              />
            )}

            {/* One pair of Lines per cluster: solid thick (actual) + solid thin (forecast) */}
            {clusters.map((c, i) => {
              const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length]
              const name  = c.clusterName.replace(/^###\s*/, '')
              return (
                <React.Fragment key={c.clusterId}>
                  <Line
                    type="monotone"
                    dataKey={`c${i}_act`}
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    name={`${name} — Actual`}
                  />
                  <Line
                    type="monotone"
                    dataKey={`c${i}_fc`}
                    stroke={color}
                    strokeWidth={1.25}
                    dot={false}
                    connectNulls={false}
                    name={`${name} — Forecast`}
                    opacity={0.85}
                  />
                </React.Fragment>
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )

  const csvChartAction = (
    <DownloadButton
      onClick={() => {
        const hdrs = ['Week', ...clusters.flatMap(c => {
          const n = c.clusterName.replace(/^###\s*/, '')
          return [`${n} Actual`, `${n} Forecast`]
        })]
        const rows = chartData.map(r => [
          r.date,
          ...clusters.flatMap((_, i) => [r[`c${i}_act`], r[`c${i}_fc`]]),
        ])
        downloadCSV(hdrs, rows as (string | number | undefined)[][], 'actuals_vs_forecast.csv')
      }}
      label="CSV"
    />
  )

  const hasAnyNotes = (commonNotes?.length ?? 0) > 0 || clusters.some(c => c.notes?.length)
  const hasInsights = !!overallSummary || clusters.some(c => c.summary || c.metrics?.mape != null)

  return (
    <div className="flex flex-col gap-5">

      {/* ── 1. Model Performance — one row per cluster ────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <SectionTitle>Model Performance</SectionTitle>
        <div className="divide-y divide-gray-100">
          {clusters.map((c, i) => {
            const color   = CLUSTER_COLORS[i % CLUSTER_COLORS.length]
            const { label: relLabel, classes: relClasses } = reliabilityLabel(c.metrics?.mape)
            const relDesc = reliabilityDescription(c.metrics?.mape)
            const trainedOn   = c.metrics?.trainedOn
            const validatedOn = c.metrics?.validatedOn
            return (
              <div key={c.clusterId} className="py-3.5 first:pt-1 last:pb-1">
                {/* Cluster name row */}
                <div className="flex items-center gap-2 mb-2.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm font-semibold text-gray-800">
                    {c.clusterName.replace(/^###\s*/, '')}
                  </span>
                </div>

                {/* Metrics row */}
                <div className="flex flex-wrap items-start gap-3 pl-4 mb-2">
                  {c.metrics?.mape != null && (
                    <MetricCard label="MAPE" value={`${c.metrics.mape.toFixed(1)}%`} sub="Mean Abs. % Error" />
                  )}
                  {c.metrics?.mae != null && (
                    <MetricCard label="MAE" value={c.metrics.mae.toLocaleString()} sub="Mean Abs. Error" />
                  )}
                  <MetricCard
                    label="Reliability"
                    value={
                      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${relClasses}`}>
                        {relLabel}
                      </span>
                    }
                  />
                  {/* Interpretation inline */}
                  <div className="flex-1 min-w-[200px] flex items-center self-stretch py-1">
                    <p className="text-xs text-gray-600 leading-relaxed">{relDesc}</p>
                  </div>
                </div>

                {/* Training / validation periods */}
                {(trainedOn ?? validatedOn) && (
                  <div className="flex flex-wrap gap-5 text-xs text-gray-500 pl-4">
                    {trainedOn   && <span><span className="font-medium text-gray-700">Trained on:</span> {trainedOn}</span>}
                    {validatedOn && <span><span className="font-medium text-gray-700">Validated on:</span> {validatedOn}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 2. Actuals vs Forecast Chart ──────────────────────────────────── */}
      {allDates.length > 0 && (
        <>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Actuals vs Forecast</SectionTitle>
              <div className="flex items-center gap-1.5 -mt-3">
                {csvChartAction}
                <button
                  onClick={() => setChartFullscreen(true)}
                  title="Full screen"
                  className="flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors border border-gray-200"
                >
                  <Maximize2 size={11} />
                </button>
              </div>
            </div>
            {renderChart(CHART_HEIGHT, scrollWidth)}
          </div>

          {chartFullscreen && (
            <FullscreenOverlay
              title="Actuals vs Forecast"
              onClose={() => setChartFullscreen(false)}
              actions={csvChartAction}
            >
              {renderChart(
                Math.max(400, window.innerHeight - 160),
                Math.max(scrollWidth, window.innerWidth - 80),
              )}
            </FullscreenOverlay>
          )}
        </>
      )}

      {/* ── 3. Summary & Key Insights ─────────────────────────────────────── */}
      {hasInsights && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <SectionTitle>Summary &amp; Key Insights</SectionTitle>

          {/* Overall summary across all clusters */}
          {overallSummary && (
            <p className="text-sm text-gray-700 leading-relaxed mb-4">
              {renderInlineMarkdown(overallSummary)}
            </p>
          )}

          {/* Per-cluster sections */}
          <div className="space-y-4">
            {clusters.map((c, i) => {
              const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length]
              const name  = c.clusterName.replace(/^###\s*/, '')
              const m     = c.metrics
              if (!c.summary && m?.mape == null) return null
              return (
                <div key={c.clusterId}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{name}</span>
                  </div>
                  <div className="pl-4">
                    {c.summary ? (
                      <p className="text-sm text-gray-700 leading-relaxed">{renderInlineMarkdown(c.summary)}</p>
                    ) : (
                      <p className="text-sm text-gray-600 leading-relaxed">
                        {reliabilityDescription(m?.mape)}
                        {m?.mape != null && ` MAPE: ${m.mape.toFixed(1)}%.`}
                        {m?.mae  != null && ` MAE: ${m.mae.toLocaleString()}.`}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 4. Forecast Table — Week + per-cluster Actuals/Predicted ─────── */}
      {tableRows.length > 0 && (() => {
        const tableBody = () => (
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Week</th>
                {clusters.map((c, i) => {
                  const name  = c.clusterName.replace(/^###\s*/, '')
                  const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length]
                  return (
                    <React.Fragment key={i}>
                      <th className="px-3 py-2 text-right font-semibold whitespace-nowrap" style={{ color }}>
                        {name} Actuals
                      </th>
                      <th className="px-3 py-2 text-right font-semibold whitespace-nowrap" style={{ color }}>
                        {name} Predicted
                      </th>
                    </React.Fragment>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rowIdx) => {
                const isFc = row._isForecast === 'yes'
                const isFirstFc = isFc && rowIdx > 0 && tableRows[rowIdx - 1]._isForecast !== 'yes'
                return (
                  <React.Fragment key={rowIdx}>
                    {isFirstFc && (
                      <tr>
                        <td
                          colSpan={1 + clusters.length * 2}
                          className="px-3 py-1 text-[10px] font-semibold text-teal-700 bg-teal-50 border-y border-teal-100 uppercase tracking-wider"
                        >
                          ▶ Forecast Period
                        </td>
                      </tr>
                    )}
                    <tr className={isFc ? 'bg-teal-50/30' : rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{row.date as string}</td>
                      {clusters.map((_, i) => (
                        <React.Fragment key={i}>
                          <td className="px-3 py-1.5 text-right text-gray-700">
                            {fmt(row[`c${i}_act`] as number | undefined)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium text-gray-800">
                            {fmt(row[`c${i}_pred`] as number | undefined)}
                          </td>
                        </React.Fragment>
                      ))}
                    </tr>
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )
        return (
          <CollapsibleTable title="Forecast" onDownloadCSV={downloadTableCSV}>
            {tableBody()}
          </CollapsibleTable>
        )
      })()}

      {/* ── 5. Model Notes — common first, then per-cluster ───────────────── */}
      {hasAnyNotes && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <SectionTitle>Model Notes</SectionTitle>
          {(commonNotes?.length ?? 0) > 0 && (
            <BulletList items={commonNotes!} />
          )}
          {clusters.map((c, i) => {
            if (!c.notes?.length) return null
            const color = CLUSTER_COLORS[i % CLUSTER_COLORS.length]
            const name  = c.clusterName.replace(/^###\s*/, '')
            return (
              <div key={c.clusterId} className="mt-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{name}</span>
                </div>
                <div className="pl-4">
                  <BulletList items={c.notes} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  artifact: AgentArtifact
}

export default function ForecastArtifact({ artifact }: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState<'chart' | 'table' | null>(null)

  // When the named Snowflake agent returns text-only (data is null),
  // parse the narrative markdown to extract structured forecast data.
  const raw = (
    artifact.data != null
      ? artifact.data
      : parseForecastNarrative(artifact.narrative ?? '')
  ) as ForecastData

  // ── Multi-cluster report mode ──────────────────────────────────────────────
  // When the agent returned per-cluster forecasts, render the full 5-section
  // multi-cluster report (performance card, chart, insights, table, notes).
  if (raw.clusters && raw.clusters.length >= 2) {
    return (
      <MultiClusterReport
        clusters={raw.clusters}
        commonNotes={raw.commonNotes}
        overallSummary={raw.overallSummary}
      />
    )
  }

  const metrics = raw.metrics ?? {}
  const historical = sortByDate(raw.historical ?? [])
  const forecastRows = sortByDate(raw.forecast ?? [])
  const validationRows = sortByDate(raw.validation ?? [])
  const modelNotes = normaliseStringArray(raw, ['modelNotes', 'model_notes', 'notes'])
  const insights = normaliseStringArray(raw, ['insights'])
  const summary = raw.summary

  // ── Reliability ───────────────────────────────────────────────────────────
  const { label: relLabel, classes: relClasses } = reliabilityLabel(metrics.mape)
  const relDescription = metrics.reliability ?? reliabilityDescription(metrics.mape)

  // Training / validation date ranges (normalise snake_case variants)
  const trainStart =
    metrics.trainStart ?? metrics.train_start
  const trainEnd =
    metrics.trainEnd ?? metrics.train_end
  const valStart =
    metrics.valStart ?? metrics.val_start
  const valEnd =
    metrics.valEnd ?? metrics.val_end
  const trainedOn =
    metrics.trainedOn ??
    (trainStart && trainEnd ? `${trainStart} – ${trainEnd}` : undefined)
  // Derive validation date range from actual validation rows when metric text is vague
  const valRowDateRange = validationRows.length > 0
    ? `${normaliseDate(validationRows[0])} – ${normaliseDate(validationRows[validationRows.length - 1])}`
    : undefined
  // Combine count from text with date range from rows if both available
  const validatedOnBase =
    metrics.validatedOn ??
    (valStart && valEnd ? `${valStart} – ${valEnd}` : undefined)
  const validatedOn = validatedOnBase && valRowDateRange
    ? `${validatedOnBase} (${valRowDateRange})`
    : validatedOnBase ?? valRowDateRange

  // ── Chart data ────────────────────────────────────────────────────────────
  // Merge historical/validation actuals and forecast into one series.
  // When historical rows are absent (narrative-only response), fall back to
  // validation rows which contain actual vs predicted for the hold-out period.
  // CI band = stacked areas: ciBase (transparent) + ciSpan (light grey).
  const actualsRows = historical.length > 0 ? historical : validationRows
  const chartData = [
    ...actualsRows.map(row => {
      const actuals = normaliseActuals(row) ?? normalisePredicted(row)
      return {
        date: normaliseDate(row),
        Actuals: actuals,
        Forecast: undefined as number | undefined,
        ciBase: undefined as number | undefined,
        ciSpan: undefined as number | undefined,
      }
    }),
    ...forecastRows.map(row => {
      const predicted = normalisePredicted(row)
      const lower = normaliseLower(row)
      const upper = normaliseUpper(row)
      const ciSpan =
        upper != null && lower != null && upper > lower ? upper - lower : undefined
      return {
        date: normaliseDate(row),
        Actuals: undefined as number | undefined,
        Forecast: predicted,
        ciBase: lower,
        ciSpan,
      }
    }),
  ]

  // Last actuals date = vertical "forecast start" reference line
  const boundaryDate =
    actualsRows.length > 0 ? normaliseDate(actualsRows[actualsRows.length - 1]) : undefined

  // ── Check for CI data ─────────────────────────────────────────────────────
  const hasCi = forecastRows.some(
    r => normaliseLower(r) != null && normaliseUpper(r) != null,
  )

  // ── Forecast table rows — all actuals history + future forecast ──────────
  // Use full historical rows when available (v2 agents), else validation rows (v3 narrative)
  const allActualsForTable = historical.length > 0 ? historical : validationRows
  const fTableRows = [
    ...allActualsForTable.map(row => ({
      week: normaliseDate(row),
      actuals: normaliseActuals(row),
      predicted: normalisePredicted(row),
      lower: undefined as number | undefined,
      upper: undefined as number | undefined,
      holiday: normaliseHoliday(row),
      isValidation: true,
    })),
    ...forecastRows.map(row => ({
      week: normaliseDate(row),
      actuals: undefined as number | undefined,
      predicted: normalisePredicted(row),
      lower: normaliseLower(row),
      upper: normaliseUpper(row),
      holiday: normaliseHoliday(row),
      isValidation: false,
    })),
  ]

  // ── Chart scroll width — give each data point at least 16 px ─────────────
  // Keeps chart readable when there are many historical weeks
  const CHART_HEIGHT = 288
  const CHART_MIN_WIDTH = 700
  const chartScrollWidth = Math.max(CHART_MIN_WIDTH, chartData.length * 16)

  const hasActualsInForecast = fTableRows.some(r => r.actuals != null)
  const hasForecastHoliday = fTableRows.some(r => !!r.holiday)

  // ── Validation table rows ─────────────────────────────────────────────────
  const vTableRows = validationRows.map(row => ({
    week: normaliseDate(row),
    actuals: normaliseActuals(row),
    predicted: normalisePredicted(row),
    errorPct: normaliseErrorPct(row),
  }))

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmt = (v: number | undefined, decimals = 2) =>
    v != null ? v.toLocaleString(undefined, { maximumFractionDigits: decimals }) : '—'

  const fmtPct = (v: number | undefined) =>
    v != null ? `${v.toFixed(1)}%` : '—'

  return (
    <div className="flex flex-col gap-5">

      {/* ── 1. Model Performance Card ─────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <SectionTitle>Model Performance</SectionTitle>

        <div className="flex flex-wrap gap-3 mb-3">
          {metrics.mape != null && (
            <MetricCard
              label="MAPE"
              value={`${metrics.mape.toFixed(1)}%`}
              sub="Mean Abs. % Error"
            />
          )}
          {metrics.mae != null && (
            <MetricCard
              label="MAE"
              value={fmt(metrics.mae)}
              sub="Mean Abs. Error"
            />
          )}
          <MetricCard
            label="Reliability"
            value={
              <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${relClasses}`}>
                {relLabel}
              </span>
            }
          />
        </div>

        <p className="text-xs text-gray-600 mb-2">{relDescription}</p>

        {(trainedOn ?? validatedOn) && (
          <div className="flex flex-wrap gap-4 text-xs text-gray-500 border-t border-gray-100 pt-2 mt-2">
            {trainedOn && (
              <span><span className="font-medium text-gray-700">Trained on:</span> {trainedOn}</span>
            )}
            {validatedOn && (
              <span><span className="font-medium text-gray-700">Validated on:</span> {validatedOn}</span>
            )}
          </div>
        )}
      </div>

      {/* ── 2. Actuals vs Forecast Chart ──────────────────────────────────── */}
      {chartData.length > 0 && (() => {
        const chartDownloadActions = (
          <>
            <DownloadButton
              onClick={() => {
                const cols = ['Date', 'Actuals', 'Forecast', 'CI Lower', 'CI Upper']
                const rows = chartData.map(r => [r.date, r.Actuals, r.Forecast,
                  r.ciBase, r.ciBase != null && r.ciSpan != null ? r.ciBase + r.ciSpan : undefined])
                downloadCSV(cols, rows, 'actuals_vs_forecast.csv')
              }}
              label="CSV"
              title="Download chart data as CSV"
            />
            <DownloadButton
              onClick={() => exportChartToPptx(chartRef, 'Actuals vs Forecast')}
              label="PPTx"
              title="Download chart as PowerPoint"
            />
          </>
        )

        const chartBody = (height: number, scrollWidth: number) => (
          <div ref={chartRef} className="w-full overflow-x-auto">
            <div style={{ minWidth: scrollWidth, height }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={v =>
                      typeof v === 'string' && v.length > 7 ? v.slice(0, 7) : String(v)
                    }
                  />
                  <YAxis tick={{ fontSize: 10 }} width={60} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />

                  {boundaryDate && chartData.length > 0 && (
                    <>
                      <ReferenceArea
                        x1={chartData[0].date}
                        x2={boundaryDate}
                        fill="#eff6ff"
                        fillOpacity={0.5}
                        label={{ value: 'Actuals', position: 'insideTopLeft', fontSize: 10, fill: '#6366f1', fontWeight: 600 }}
                      />
                      <ReferenceArea
                        x1={boundaryDate}
                        x2={chartData[chartData.length - 1].date}
                        fill="#f0fdf4"
                        fillOpacity={0.5}
                        label={{ value: 'Forecast', position: 'insideTopLeft', fontSize: 10, fill: '#0d9488', fontWeight: 600 }}
                      />
                    </>
                  )}

                  {boundaryDate && (
                    <ReferenceLine x={boundaryDate} stroke="#9ca3af" strokeDasharray="4 4" strokeWidth={1.5} />
                  )}

                  {hasCi && (
                    <>
                      <Area type="monotone" dataKey="ciBase" stroke="none" fill="transparent"
                        stackId="ci" legendType="none" connectNulls={false} isAnimationActive={false} name="CI Lower" />
                      <Area type="monotone" dataKey="ciSpan" stroke="none" fill="#e5e7eb"
                        fillOpacity={0.7} stackId="ci" legendType="none" connectNulls={false}
                        isAnimationActive={false} name="Confidence Interval" />
                    </>
                  )}

                  <Line type="monotone" dataKey="Actuals" stroke="#6366f1" strokeWidth={2} dot={false} connectNulls={false} />
                  <Line type="monotone" dataKey="Forecast" stroke="#0d9488" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )

        return (
          <>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <SectionTitle>Actuals vs Forecast</SectionTitle>
                <div className="flex items-center gap-1.5 -mt-3">
                  {chartDownloadActions}
                  <button
                    onClick={() => setFullscreen('chart')}
                    title="Full screen"
                    className="flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors border border-gray-200"
                  >
                    <Maximize2 size={11} />
                  </button>
                </div>
              </div>
              {chartBody(CHART_HEIGHT, chartScrollWidth)}
            </div>

            {fullscreen === 'chart' && (
              <FullscreenOverlay
                title="Actuals vs Forecast"
                onClose={() => setFullscreen(null)}
                actions={chartDownloadActions}
              >
                {chartBody(Math.max(400, window.innerHeight - 160), Math.max(chartScrollWidth, window.innerWidth - 80))}
              </FullscreenOverlay>
            )}
          </>
        )
      })()}

      {/* ── 3. Summary & Key Insights Card ────────────────────────────────── */}
      {(summary ?? insights.length > 0) && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <SectionTitle>Summary &amp; Key Insights</SectionTitle>
          {summary && (
            <p className="text-sm text-gray-700 mb-3 leading-relaxed">{renderInlineMarkdown(summary)}</p>
          )}
          <BulletList items={insights} />
        </div>
      )}

      {/* ── 4. Forecast Table (all actuals history + future weeks) ──────── */}
      {fTableRows.length > 0 && (() => {
        const tableDownloadCSV = () => {
          const hdrs = ['Week', ...(hasActualsInForecast ? ['Actuals'] : []), 'Predicted',
            ...(hasCi ? ['CI Lower', 'CI Upper'] : []), ...(hasForecastHoliday ? ['Holiday'] : [])]
          const rows = fTableRows.map(r => [r.week, ...(hasActualsInForecast ? [r.actuals] : []),
            r.predicted, ...(hasCi ? [r.lower, r.upper] : []), ...(hasForecastHoliday ? [r.holiday] : [])])
          downloadCSV(hdrs, rows, 'forecast.csv')
        }

        const tableBody = (scrollable: boolean) => (
          <table className="min-w-full text-xs">
            <thead className={scrollable ? 'sticky top-0 z-10' : ''}>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Week</th>
                {hasActualsInForecast && (
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Actuals</th>
                )}
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Predicted</th>
                {hasCi && (
                  <>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">CI Lower</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-600">CI Upper</th>
                  </>
                )}
                {hasForecastHoliday && (
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Holiday</th>
                )}
              </tr>
            </thead>
            <tbody>
              {fTableRows.map((row, i) => {
                const isFirstForecast = !row.isValidation && (i === 0 || fTableRows[i - 1].isValidation)
                return (
                  <React.Fragment key={i}>
                    {isFirstForecast && (
                      <tr>
                        <td colSpan={99} className="px-3 py-1 text-[10px] font-semibold text-teal-700 bg-teal-50 border-y border-teal-100 uppercase tracking-wider">
                          ▶ Forecast Period
                        </td>
                      </tr>
                    )}
                    <tr className={row.isValidation ? (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60') : 'bg-teal-50/30'}>
                      <td className="px-3 py-1.5 text-gray-700">{row.week}</td>
                      {hasActualsInForecast && (
                        <td className="px-3 py-1.5 text-right text-gray-700">{fmt(row.actuals)}</td>
                      )}
                      <td className="px-3 py-1.5 text-right font-medium text-gray-800">{fmt(row.predicted)}</td>
                      {hasCi && (
                        <>
                          <td className="px-3 py-1.5 text-right text-gray-500">{fmt(row.lower)}</td>
                          <td className="px-3 py-1.5 text-right text-gray-500">{fmt(row.upper)}</td>
                        </>
                      )}
                      {hasForecastHoliday && (
                        <td className="px-3 py-1.5 text-gray-600">{row.holiday || '—'}</td>
                      )}
                    </tr>
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )

        return (
          <>
            <CollapsibleTable
              title="Forecast"
              onDownloadCSV={tableDownloadCSV}
              onFullscreen={() => setFullscreen('table')}
            >
              {tableBody(true)}
            </CollapsibleTable>

            {fullscreen === 'table' && (
              <FullscreenOverlay
                title="Forecast"
                onClose={() => setFullscreen(null)}
                actions={<DownloadButton onClick={tableDownloadCSV} label="CSV" title="Download as CSV" />}
              >
                <div className="overflow-auto h-full">
                  {tableBody(true)}
                </div>
              </FullscreenOverlay>
            )}
          </>
        )
      })()}

      {/* ── 5. Validation Table ───────────────────────────────────────────── */}
      {vTableRows.length > 0 && (
        <CollapsibleTable
          title="Validation"
          onDownloadCSV={() => {
            downloadCSV(
              ['Week', 'Actuals', 'Predicted', 'Error %'],
              vTableRows.map(r => [r.week, r.actuals, r.predicted, r.errorPct != null ? `${r.errorPct.toFixed(1)}%` : '']),
              'validation.csv',
            )
          }}
        >
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left font-semibold text-gray-600">Week</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Actuals</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Predicted</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600">Error %</th>
              </tr>
            </thead>
            <tbody>
              {vTableRows.map((row, i) => {
                const err = row.errorPct
                const errColor =
                  err == null
                    ? 'text-gray-500'
                    : err > 20
                    ? 'text-red-600 font-medium'
                    : err > 10
                    ? 'text-yellow-600'
                    : 'text-green-700'
                return (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                    <td className="px-3 py-1.5 text-gray-700">{row.week}</td>
                    <td className="px-3 py-1.5 text-right text-gray-700">{fmt(row.actuals)}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-gray-800">
                      {fmt(row.predicted)}
                    </td>
                    <td className={`px-3 py-1.5 text-right ${errColor}`}>
                      {fmtPct(err)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CollapsibleTable>
      )}

      {/* ── 6. Model Notes ────────────────────────────────────────────────── */}
      {modelNotes.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <SectionTitle>Model Notes</SectionTitle>
          <BulletList items={modelNotes} />
        </div>
      )}
    </div>
  )
}
