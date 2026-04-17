"use client"

import React, { useState, useRef, useEffect } from 'react'
import {
  ComposedChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WF_POS  = '#6aaa84'
const WF_NEG  = '#c97a7a'
const WF_BASE = '#3b82f6'

const ACCENT: Record<string, string> = {
  w1:          '#3b82f6',
  w2:          '#c97a7a',
  w3:          '#6aaa84',
  w4:          '#a78bfa',
  competitive: '#f59e0b',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TableRow { cells: string[] }
interface WFItem   { name: string; contribution: number }

interface ParsedSection {
  id: string
  rawTitle: string
  title: string
  headers: string[]
  rows: TableRow[]
  interpretation: string
}

interface ParsedReport {
  headingTitle: string
  summaryLines: string[]
  sections: ParsedSection[]
  /** Brand1 H1 share extracted from heading, e.g. 29.11 */
  shareBaseline: number
  /** Brand1 H2 share extracted from heading, e.g. 32.37 */
  shareFinal: number
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

/** Strip markdown bold / italic / code markers */
function stripMd(s: string): string {
  return s
    .replace(/\*{1,3}([^*]*)\*{1,3}/g, '$1')
    .replace(/_([^_]*)_/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/—/g, '-')
    .trim()
}

/** Strip parenthetical annotations like "(−342,827 claims)" */
function stripParens(s: string): string {
  return s.replace(/\s*\([^)]*\)/g, '').trim()
}

/** Parse a numeric value from a raw string (handles pp, %, commas, Unicode minus) */
function parseNum(s: string): number {
  const clean = stripMd(s)
    .replace(/dispensed/gi, '')
    .replace(/[,\s]/g, '')
    .replace(/\u2212/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/pp\b/gi, '')
    .replace(/%/g, '')
    .trim()
  return parseFloat(clean) || 0
}

/**
 * Scale contribution items so their sum equals exactly (finalVal − baseline).
 * This guarantees the waterfall staircase always lands on the End bar.
 */
function normalizeItems(items: WFItem[], baseline: number, finalVal: number): WFItem[] {
  const rawSum    = items.reduce((s, i) => s + i.contribution, 0)
  const targetGap = finalVal - baseline
  if (rawSum === 0 || Math.abs(rawSum - targetGap) <= 0.0001) return items
  const scale = targetGap / rawSum
  return items.map(i => ({ ...i, contribution: i.contribution * scale }))
}

// ---------------------------------------------------------------------------
// Markdown table parser
// ---------------------------------------------------------------------------

function parseMarkdownTable(lines: string[]): { headers: string[]; rows: TableRow[] } {
  const tableLines = lines.filter(l => l.trim().startsWith('|'))
  if (tableLines.length === 0) return { headers: [], rows: [] }

  const splitRow = (line: string): string[] =>
    line.split('|').slice(1, -1).map(c => c.trim())

  const isSeparator = (line: string) =>
    /^\|[\s|:-]+\|$/.test(line.trim())

  let headers: string[] = []
  const rows: TableRow[] = []
  let headerParsed = false

  for (const line of tableLines) {
    if (isSeparator(line)) { headerParsed = true; continue }
    const cells = splitRow(line)
    if (cells.length === 0) continue
    if (!headerParsed && headers.length === 0) {
      headers = cells
    } else if (headerParsed || headers.length > 0) {
      if (cells.every(c => c === '' || c === '-')) continue
      rows.push({ cells })
    }
  }
  return { headers, rows }
}

// ---------------------------------------------------------------------------
// Section ID detection
// ---------------------------------------------------------------------------

function detectSectionId(rawTitle: string): string | null {
  if (/monthly share trend/i.test(rawTitle)) return '__monthly_trend__'
  if (/waterfall\s*1/i.test(rawTitle))        return 'w1'
  if (/waterfall\s*2/i.test(rawTitle))        return 'w2'
  if (/waterfall\s*3/i.test(rawTitle))        return 'w3'
  if (/waterfall\s*4/i.test(rawTitle))        return 'w4'
  if (/competitive flow/i.test(rawTitle))     return 'competitive'
  if (/recommendation/i.test(rawTitle))       return 'recommendations'
  return null
}

/** Strip "WATERFALL N: " prefix from a section title */
function cleanTitle(rawTitle: string): string {
  return rawTitle.replace(/^waterfall\s*\d+\s*:\s*/i, '').trim()
}

// ---------------------------------------------------------------------------
// Top-level narrative parser
// ---------------------------------------------------------------------------

function parseReport(narrative: string): ParsedReport {
  const chunks = narrative.split(/\n(?=###\s)/g)

  // Header chunk
  const headerChunk = chunks[0] ?? ''
  let headingTitle = ''
  const summaryLines: string[] = []

  for (const line of headerChunk.split('\n')) {
    const stripped = line.replace(/^#{1,3}\s*/, '').trim()
    if (!headingTitle && line.match(/^#{1,3}\s/)) {
      headingTitle = stripped
    } else if (stripped.length > 0 && !line.match(/^#{1,3}\s/) && !/^-{2,}$/.test(stripped)) {
      summaryLines.push(stripped)
    }
  }

  const sections: ParsedSection[] = []
  let monthlyTrendText = ''

  for (let ci = 1; ci < chunks.length; ci++) {
    const chunk = chunks[ci].trim()
    const chunkLines = chunk.split('\n')
    const headingLine = chunkLines[0] ?? ''
    const rawTitle = headingLine.replace(/^#{1,3}\s*/, '').trim()
    const id = detectSectionId(rawTitle)

    if (id === null) continue

    // Capture monthly trend body text for use as competitive interpretation
    if (id === '__monthly_trend__') {
      monthlyTrendText = chunkLines
        .slice(1)
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('|') && !/^-{2,}$/.test(l))
        .join(' ')
      continue
    }

    const title = cleanTitle(rawTitle)
    const tableLines: string[] = []
    const interpLines: string[] = []

    for (const line of chunkLines.slice(1)) {
      const trimmed = line.trim()
      if (trimmed.startsWith('|')) {
        tableLines.push(trimmed)
      } else if (trimmed.length > 0 && !/^-{2,}$/.test(trimmed)) {
        interpLines.push(trimmed)
      }
    }

    const { headers, rows } = parseMarkdownTable(tableLines)

    const interpretationText = interpLines
      .map(l => stripMd(l))
      .filter(l => /^(Interpretation|Pattern)\s*:/i.test(l))
      .map(l => l.replace(/^(Interpretation|Pattern)\s*:\s*/i, '').trim())
      .join(' ')

    sections.push({ id, rawTitle, title, headers, rows, interpretation: interpretationText })
  }

  // Attach monthly trend text to competitive if it has no interpretation
  const compSec = sections.find(s => s.id === 'competitive')
  if (compSec && !compSec.interpretation && monthlyTrendText) {
    compSec.interpretation = monthlyTrendText
  }

  // Extract subject brand's H1→H2 share from heading: "(29.11% → 32.37%)"
  const shareMatch = headingTitle.match(/([\d.]+)%\s*[→\-]+\s*([\d.]+)%/)
  const shareBaseline = shareMatch ? parseFloat(shareMatch[1]) : 0
  const shareFinal    = shareMatch ? parseFloat(shareMatch[2]) : 0

  return { headingTitle, summaryLines, sections, shareBaseline, shareFinal }
}

// ---------------------------------------------------------------------------
// Waterfall data builders
// ---------------------------------------------------------------------------

function buildW1Data(section: ParsedSection) {
  const { headers, rows } = section
  const hLower = headers.map(h => h.toLowerCase())
  const stepIdx     = hLower.findIndex(h => h.includes('step'))
  const driverIdx   = hLower.findIndex(h => h.includes('driver'))
  const shareImpIdx = hLower.findIndex(h => h.includes('share impact'))
  const runningIdx  = hLower.findIndex(h => h.includes('running share'))

  let baseline = 0, finalVal = 0
  const items: WFItem[] = []

  for (const row of rows) {
    const step   = stripMd(stepIdx  >= 0 ? (row.cells[stepIdx]  ?? '') : '')
    const driver = driverIdx >= 0 ? (row.cells[driverIdx] ?? '') : ''
    const impact = shareImpIdx >= 0 ? (row.cells[shareImpIdx] ?? '') : ''
    const running = runningIdx >= 0 ? (row.cells[runningIdx] ?? '') : ''

    if (/^start$/i.test(step)) {
      baseline = parseNum(running)
    } else if (/^end$/i.test(step)) {
      finalVal = parseNum(running)
    } else if (/^\d+$/.test(step)) {
      // Strip parenthetical volume counts from driver name
      const name = stripParens(stripMd(driver)).slice(0, 30)
      items.push({ name, contribution: parseNum(impact) })
    }
  }

  return { baseline, finalVal, items: normalizeItems(items, baseline, finalVal) }
}

/**
 * Extract H1 and H2 market share for a named brand from the competitive flow section.
 * Returns null if the brand row or numeric values can't be found.
 */
function extractBrandShares(
  brandPattern: RegExp,
  compSection: ParsedSection | undefined,
): { h1: number; h2: number } | null {
  if (!compSection) return null
  const { headers, rows } = compSection
  const hLower   = headers.map(h => h.toLowerCase())
  const brandIdx = hLower.findIndex(h => h.includes('brand') || h.includes('name'))
  const h1Idx    = hLower.findIndex(h => h.includes('h1'))
  const h2Idx    = hLower.findIndex(h => h.includes('h2'))
  if (h1Idx < 0 || h2Idx < 0) return null

  for (const row of rows) {
    const brand = stripMd(row.cells[brandIdx] ?? '')
    if (!brandPattern.test(brand)) continue
    const h1 = parseNum(row.cells[h1Idx] ?? '')
    const h2 = parseNum(row.cells[h2Idx] ?? '')
    if (h1 > 0) return { h1, h2 }
  }
  return null
}

function buildW2Data(
  section: ParsedSection,
  brand7H1: number,
  brand7H2: number,
) {
  const { headers, rows } = section
  const hLower    = headers.map(h => h.toLowerCase())
  const stepIdx   = hLower.findIndex(h => h.includes('step'))
  const payerIdx  = hLower.findIndex(h => h.includes('payer channel'))
  const claimsIdx = hLower.findIndex(h => h.includes('claims lost'))

  const items: WFItem[] = []

  for (const row of rows) {
    const step = stripMd(stepIdx >= 0 ? (row.cells[stepIdx] ?? '') : '')
    if (!/^\d+$/.test(step)) continue
    const payer  = payerIdx  >= 0 ? (row.cells[payerIdx]  ?? '') : ''
    const claims = claimsIdx >= 0 ? (row.cells[claimsIdx] ?? '') : ''
    const name   = stripParens(stripMd(payer)).slice(0, 22)
    // Claims lost → negative contributions (Brand7 share declined)
    const contribution = -Math.abs(parseNum(claims))
    items.push({ name, contribution })
  }

  // Anchor to Brand7's actual H1→H2 share so staircase mirrors W1 style
  const baseline = brand7H1 > 0 ? brand7H1 : items.reduce((s, i) => s + i.contribution, 0)
  const finalVal = brand7H2 > 0 ? brand7H2 : 0
  return { baseline, finalVal, items: normalizeItems(items, baseline, finalVal) }
}

function buildW3Data(section: ParsedSection, shareBaseline: number, shareFinal: number) {
  const { headers, rows } = section
  const hLower    = headers.map(h => h.toLowerCase())
  const stepIdx   = hLower.findIndex(h => h.includes('step'))
  const nameIdx   = hLower.findIndex(h => h.includes('factor') || h.includes('driver'))
  const changeIdx = hLower.findIndex(h => h.includes('change'))

  const items: WFItem[] = []

  for (const row of rows) {
    const step = stripMd(stepIdx >= 0 ? (row.cells[stepIdx] ?? '') : '')
    if (!/^\d+$/.test(step)) continue

    const name      = nameIdx   >= 0 ? stripMd(row.cells[nameIdx]   ?? '').slice(0, 28) : step
    const changeRaw = changeIdx >= 0 ? stripMd(row.cells[changeIdx] ?? '') : ''

    // Skip stable / unchanged rows
    if (/^stable$|^unchanged$|^flat$/i.test(changeRaw.trim())) continue

    // Extract parenthetical percentage if present: "−4,155 (−0.4%)"
    const parenMatch = changeRaw.match(/\(([^)]+)\)/)
    const valStr     = parenMatch ? parenMatch[1] : changeRaw

    let contribution = parseNum(valStr)

    // Range value "1.8pp to 3.9pp" → average
    if (!contribution && /to/i.test(valStr)) {
      const parts = valStr.match(/[-+]?\d+\.?\d*/g)
      if (parts && parts.length >= 2) {
        contribution = (parseFloat(parts[0]) + parseFloat(parts[1])) / 2
      }
    }

    // Market denominator contraction is a POSITIVE factor for share — flip sign
    if (/denominator|market/i.test(name) && contribution < 0) {
      contribution = -contribution
    }

    if (contribution === 0) continue  // skip zero-bars
    items.push({ name, contribution })
  }

  // Anchor to real subject share values so staircase bridges H1→H2 exactly
  const baseline = shareBaseline > 0 ? shareBaseline : 0
  const finalVal = shareFinal    > 0 ? shareFinal    : items.reduce((s, i) => s + i.contribution, 0)
  return { baseline, finalVal, items: normalizeItems(items, baseline, finalVal) }
}

function buildW4Data(section: ParsedSection, shareBaseline: number, shareFinal: number) {
  const { headers, rows } = section
  const hLower     = headers.map(h => h.toLowerCase())
  const rankIdx    = hLower.findIndex(h => h.includes('rank') || h.includes('step'))
  const nameIdx    = hLower.findIndex(h => h.includes('region') || h.includes('name'))
  const contribIdx = hLower.findIndex(h => h.includes('contribution') || h.includes('impact'))

  const items: WFItem[] = []

  for (const row of rows) {
    const rank = stripMd(rankIdx >= 0 ? (row.cells[rankIdx] ?? '') : '')
    if (!/^\d+$/.test(rank)) continue  // skip Total row
    const name         = nameIdx    >= 0 ? stripMd(row.cells[nameIdx]    ?? '').slice(0, 15) : rank
    const contribution = contribIdx >= 0 ? parseNum(row.cells[contribIdx] ?? '') : 0
    items.push({ name, contribution })
  }

  // Anchor to Brand1's actual H1→H2 share so staircase mirrors W1 and W3 style
  const baseline = shareBaseline > 0 ? shareBaseline : 0
  const finalVal = shareFinal    > 0 ? shareFinal    : items.reduce((s, i) => s + i.contribution, 0)
  return { baseline, finalVal, items: normalizeItems(items, baseline, finalVal) }
}

// ---------------------------------------------------------------------------
// WaterfallChart
// ---------------------------------------------------------------------------

interface WaterfallChartProps {
  baseline: number
  finalVal: number
  items: WFItem[]
  yTickFormatter: (v: number) => string
  baselineLabel: string
  finalLabel: string
}

interface WFPoint {
  name: string; offset: number; value: number; isNeg: boolean; isTotal: boolean; raw: number
}

function WaterfallChart({ baseline, finalVal, items, yTickFormatter, baselineLabel, finalLabel }: WaterfallChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w) setContainerWidth(Math.floor(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (items.length === 0) {
    return <p className="text-sm text-gray-400 italic mt-2">No waterfall data available.</p>
  }

  const chartData: WFPoint[] = []

  chartData.push({ name: baselineLabel, offset: 0, value: baseline, isNeg: false, isTotal: true, raw: baseline })

  let running = baseline
  for (const item of items) {
    const isNeg  = item.contribution < 0
    const offset = isNeg ? running + item.contribution : running
    chartData.push({
      name: item.name,
      offset: Math.max(0, offset),
      value: Math.abs(item.contribution),
      isNeg,
      isTotal: false,
      raw: item.contribution,
    })
    running += item.contribution
  }

  chartData.push({ name: finalLabel, offset: 0, value: Math.max(0, finalVal), isNeg: false, isTotal: true, raw: finalVal })

  // Ensure Start / End total bars are always visually present even when value = 0
  const rawMax = Math.max(...chartData.map(d => d.offset + d.value), 1)
  const minVis = rawMax * 0.04
  chartData.forEach(d => { if (d.isTotal && d.value < minVis) d.value = minVis })

  const maxVal = Math.max(...chartData.map(d => d.offset + d.value), 1)
  const chartH = 280
  const chartW = containerWidth > 0 ? containerWidth - 32 : 700

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: WFPoint }> }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
        <p className="font-semibold text-gray-800 mb-1">{d.name}</p>
        <p style={{ color: d.isTotal ? WF_BASE : d.isNeg ? WF_NEG : WF_POS }}>
          {d.isTotal ? yTickFormatter(d.raw) : (d.isNeg ? '' : '+') + d.raw.toFixed(2)}
        </p>
      </div>
    )
  }

  return (
    <div ref={containerRef}>
      <div style={{ width: chartW, height: chartH }}>
        <ComposedChart width={chartW} height={chartH} data={chartData}
          margin={{ top: 8, right: 16, bottom: 72, left: 48 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: '#6b7280' }}
            angle={-35}
            textAnchor="end"
            height={68}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6b7280' }}
            tickFormatter={yTickFormatter}
            domain={[0, maxVal * 1.12]}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
          <Bar dataKey="offset" stackId="wf" fill="transparent" isAnimationActive={false} legendType="none" />
          <Bar dataKey="value"  stackId="wf" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {chartData.map((entry, i) => (
              <Cell key={`cell-${i}`} fill={entry.isTotal ? WF_BASE : entry.isNeg ? WF_NEG : WF_POS} opacity={0.85} />
            ))}
          </Bar>
        </ComposedChart>
      </div>

      <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 justify-center">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: WF_POS }} /> Positive
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: WF_NEG }} /> Negative
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: WF_BASE }} /> Start | End
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StyledTable
// ---------------------------------------------------------------------------

function StyledTable({ headers, rows }: { headers: string[]; rows: TableRow[] }) {
  if (headers.length === 0 && rows.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table style={{ borderCollapse: 'collapse', width: '100%' }} className="text-xs">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="font-semibold text-gray-600 px-3 py-2 text-left whitespace-nowrap"
                style={{ background: 'var(--bg-secondary, #f9fafb)', borderBottom: '1px solid #e5e7eb' }}>
                {stripMd(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? 'white' : 'var(--bg-secondary, #f9fafb)' }}>
              {row.cells.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5 text-gray-700 align-top"
                  style={{ borderBottom: '1px solid #f3f4f6' }}>
                  {stripMd(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InterpretationBlock
// ---------------------------------------------------------------------------

function InterpretationBlock({ text }: { text: string }) {
  if (!text.trim()) return null
  const label = /^(pattern)/i.test(text) ? 'Pattern' : 'Interpretation'
  const body  = text.replace(/^(Interpretation|Pattern)\s*:\s*/i, '').trim()
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-md px-4 py-3 mt-3">
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm text-blue-900 leading-relaxed">{body}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CollapsibleCard
// ---------------------------------------------------------------------------

interface CollapsibleCardProps {
  title: string
  children: React.ReactNode
  isOpen: boolean
  onToggle: () => void
  accentColor?: string
}

function CollapsibleCard({ title, children, isOpen, onToggle, accentColor = '#6b7280' }: CollapsibleCardProps) {
  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors">
        <span className="flex-shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: accentColor }} />
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-gray-700">{title}</span>
        <span className="flex-shrink-0 transition-transform duration-200 text-gray-400"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100">{children}</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RecommendationsTable
// ---------------------------------------------------------------------------

function getPriorityLevel(cell: string): 'high' | 'medium' | 'caution' | 'neutral' {
  if (cell.includes('🔴') || /^high|^critical|^urgent/i.test(cell)) return 'high'
  if (cell.includes('🟡') || cell.includes('🟠') || /^medium|^moderate/i.test(cell)) return 'medium'
  if (cell.includes('⚠') || /^warn|^caution|^low/i.test(cell)) return 'caution'
  return 'neutral'
}

const PRIORITY_BORDER: Record<string, string> = {
  high:    '#ef4444',   // red
  medium:  '#f59e0b',   // amber
  caution: '#9ca3af',   // grey
  neutral: '#d1d5db',   // light grey
}

const PRIORITY_LABELS: Record<string, string> = {
  high:    'High Priority',
  medium:  'Medium Priority',
  caution: 'Caution',
}

function RecommendationsTable({ headers, rows }: { headers: string[]; rows: TableRow[] }) {
  if (rows.length === 0) return null
  const hLower       = headers.map(h => h.toLowerCase())
  const priorityIdx  = hLower.findIndex(h => h.includes('priority'))
  const actionIdx    = hLower.findIndex(h => h.includes('action'))
  const rationaleIdx = hLower.findIndex(h => h.includes('rationale'))

  return (
    <div className="flex flex-col gap-3">
      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {(Object.entries(PRIORITY_LABELS) as [string, string][]).map(([level, label]) => (
          <span key={level} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span
              className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: PRIORITY_BORDER[level] }}
            />
            {label}
          </span>
        ))}
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2">
      {rows.map((row, ri) => {
        const priorityCell  = priorityIdx  >= 0 ? (row.cells[priorityIdx]  ?? '') : ''
        const actionCell    = actionIdx    >= 0 ? (row.cells[actionIdx]    ?? '') : (row.cells[1] ?? '')
        const rationaleCell = rationaleIdx >= 0 ? (row.cells[rationaleIdx] ?? '') : (row.cells[2] ?? '')

        const level       = getPriorityLevel(priorityCell)
        const borderColor = PRIORITY_BORDER[level]

        return (
          <div key={ri} className="rounded-lg px-4 py-3 bg-white"
            style={{
              border:      '1px solid #e5e7eb',
              borderLeft:  `4px solid ${borderColor}`,
            }}>
            <p className="text-sm font-semibold leading-snug text-gray-800">
              {stripMd(actionCell)}
            </p>
            {rationaleCell && (
              <p className="text-xs mt-1 leading-relaxed text-gray-500">
                {stripMd(rationaleCell)}
              </p>
            )}
          </div>
        )
      })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Suggested follow-ups generator
// ---------------------------------------------------------------------------

function generateFollowUps(report: ParsedReport): string[] {
  const allText   = [report.headingTitle, ...report.summaryLines].join(' ')
  const brands    = [...new Set(allText.match(/Brand\d+/g) ?? [])]
  const subject   = brands[0] ?? 'Brand1'
  const collapsed = brands.find(b => b !== subject) ?? 'Brand7'

  // Find top and weakest region from W4
  const w4 = report.sections.find(s => s.id === 'w4')
  let topRegion  = 'South'
  let weakRegion = 'North East'
  if (w4) {
    const digitRows = w4.rows.filter(r => /^\d+$/.test(stripMd(r.cells[0] ?? '')))
    if (digitRows.length > 0) {
      topRegion  = stripMd(digitRows[0].cells[1] ?? topRegion)
      weakRegion = stripMd(digitRows[digitRows.length - 1].cells[1] ?? weakRegion)
    }
  }

  return [
    `What would ${subject}'s share look like if ${collapsed} recovers to H1 2025 levels?`,
    `Which payer channels pose the highest formulary risk to ${subject} over the next 6 months?`,
    `Why did ${weakRegion} underperform — is it structural or payer-driven?`,
    `Show me month-by-month fill rates for ${subject} vs ${collapsed} across all payer channels`,
    `How does ${subject}'s abandonment trend in ${topRegion} compare to the national average?`,
  ]
}

// ---------------------------------------------------------------------------
// Public helper — call from ChatMessage to get generated follow-ups
// ---------------------------------------------------------------------------

export function getCausalFollowUps(narrative: string): string[] {
  return generateFollowUps(parseReport(narrative))
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CausalNarrativeReport({
  narrative,
  onFollowup,
}: {
  narrative: string
  onFollowup?: (q: string) => void
}) {
  const report = parseReport(narrative)
  const [openId, setOpenId] = useState<string | null>('w1')
  const toggle = (id: string) => setOpenId(prev => (prev === id ? null : id))

  const sectionMap = new Map<string, ParsedSection>()
  for (const sec of report.sections) sectionMap.set(sec.id, sec)

  const w1             = sectionMap.get('w1')
  const w2             = sectionMap.get('w2')
  const w3             = sectionMap.get('w3')
  const w4             = sectionMap.get('w4')
  const competitive    = sectionMap.get('competitive')
  const recommendations = sectionMap.get('recommendations')

  // Extract Brand7's H1/H2 shares from the competitive table for W2 anchoring
  const brand7Shares = extractBrandShares(/brand7/i, competitive)

  return (
    <div className="flex flex-col gap-3">

      {/* ── 1. Header Card ──────────────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-lg bg-white px-5 py-4">
        {report.headingTitle && (
          <h2 className="text-base font-bold text-gray-900 leading-snug mb-2">
            {report.headingTitle}
          </h2>
        )}
        {report.summaryLines.map((line, i) => (
          <p key={i} className="text-sm text-gray-700 leading-relaxed">{stripMd(line)}</p>
        ))}
      </div>

      {/* ── 2. Waterfall 1 (open by default) ───────────────────────────────── */}
      {w1 && (
        <CollapsibleCard title={w1.title} isOpen={openId === 'w1'} onToggle={() => toggle('w1')} accentColor={ACCENT.w1}>
          {(() => {
            const { baseline, finalVal, items } = buildW1Data(w1)
            return (
              <>
                <WaterfallChart baseline={baseline} finalVal={finalVal} items={items}
                  yTickFormatter={v => v.toFixed(2) + '%'} baselineLabel="H1 Baseline" finalLabel="H2 Result" />
                <InterpretationBlock text={w1.interpretation} />
              </>
            )
          })()}
        </CollapsibleCard>
      )}

      {/* ── 3. Waterfall 2 (collapsed) ─────────────────────────────────────── */}
      {w2 && (
        <CollapsibleCard title={w2.title} isOpen={openId === 'w2'} onToggle={() => toggle('w2')} accentColor={ACCENT.w2}>
          {(() => {
            const { baseline, finalVal, items } = buildW2Data(
              w2,
              brand7Shares?.h1 ?? 0,
              brand7Shares?.h2 ?? 0,
            )
            return (
              <>
                <WaterfallChart baseline={baseline} finalVal={finalVal} items={items}
                  yTickFormatter={v => v.toFixed(2) + '%'}
                  baselineLabel="H1 Share" finalLabel="H2 Share" />
                <InterpretationBlock text={w2.interpretation} />
              </>
            )
          })()}
        </CollapsibleCard>
      )}

      {/* ── 4. Waterfall 3 — chart (collapsed) ─────────────────────────────── */}
      {w3 && (
        <CollapsibleCard title={w3.title} isOpen={openId === 'w3'} onToggle={() => toggle('w3')} accentColor={ACCENT.w3}>
          {(() => {
            const { baseline, finalVal, items } = buildW3Data(w3, report.shareBaseline, report.shareFinal)
            return (
              <>
                <WaterfallChart baseline={baseline} finalVal={finalVal} items={items}
                  yTickFormatter={v => v.toFixed(2) + '%'} baselineLabel="H1 Baseline" finalLabel="H2 Result" />
                <InterpretationBlock text={w3.interpretation} />
              </>
            )
          })()}
        </CollapsibleCard>
      )}

      {/* ── 5. Waterfall 4 — chart (collapsed) ─────────────────────────────── */}
      {w4 && (
        <CollapsibleCard title={w4.title} isOpen={openId === 'w4'} onToggle={() => toggle('w4')} accentColor={ACCENT.w4}>
          {(() => {
            const { baseline, finalVal, items } = buildW4Data(w4, report.shareBaseline, report.shareFinal)
            return (
              <>
                <WaterfallChart baseline={baseline} finalVal={finalVal} items={items}
                  yTickFormatter={v => v.toFixed(2) + '%'} baselineLabel="H1 Share" finalLabel="H2 Share" />
                <InterpretationBlock text={w4.interpretation} />
              </>
            )
          })()}
        </CollapsibleCard>
      )}

      {/* ── 6. Competitive Flow (collapsed) ────────────────────────────────── */}
      {competitive && (
        <CollapsibleCard title={competitive.title} isOpen={openId === 'competitive'} onToggle={() => toggle('competitive')} accentColor={ACCENT.competitive}>
          <StyledTable
            headers={competitive.headers.map(h => {
              const lower = h.toLowerCase()
              if (lower === 'change' || lower === 'share change') return 'Share Change'
              if (/volume trend/i.test(h)) return 'Volume Change'
              return h
            })}
            rows={competitive.rows}
          />
          <InterpretationBlock text={competitive.interpretation} />
        </CollapsibleCard>
      )}

      {/* ── 7. Recommendations (always visible) ────────────────────────────── */}
      {recommendations && (
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: '#6b7280' }} />
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">
              {recommendations.title}
            </span>
          </div>
          <div className="px-4 py-3">
            <RecommendationsTable headers={recommendations.headers} rows={recommendations.rows} />
          </div>
        </div>
      )}


    </div>
  )
}
