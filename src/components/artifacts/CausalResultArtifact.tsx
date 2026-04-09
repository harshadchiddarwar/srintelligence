"use client"

/**
 * CausalResultArtifact — renders causal inference results.
 *
 * Handles four causal sub-types:
 *   contribution — driver waterfall / bar chart + contribution table
 *   drivers      — ranked driver table with direction badges
 *   validation   — test result badges (pass/fail) + recommendations
 *   narrative    — plain-text narrative sections
 *   pipeline     — combined view of all sections
 */

import type { AgentArtifact } from '../../types/agent'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts'

interface Props {
  artifact: AgentArtifact
}

interface CausalDriver {
  driver: string
  contribution?: number
  importance?: number
  direction?: string
  effect?: number
  pValue?: number
  significant?: boolean
  baselineValue?: number
  targetValue?: number
  absoluteChange?: number
  relativeChange?: number
}

interface ValidationTest {
  test: string
  statistic?: number
  pValue?: number
  passed: boolean
  description?: string
  recommendation?: string
}

interface NarrativeSection {
  section: string
  narrative: string
  confidence?: string
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

function ContributionView({ drivers }: { drivers: CausalDriver[] }) {
  const chartData = drivers
    .slice(0, 15)
    .map((d) => ({
      name: d.driver.length > 18 ? d.driver.slice(0, 18) + '…' : d.driver,
      value: d.contribution ?? 0,
    }))

  const maxAbs = Math.max(...chartData.map((d) => Math.abs(d.value)), 1)

  return (
    <div className="space-y-4">
      <div className="w-full h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[-maxAbs * 1.1, maxAbs * 1.1]} tickFormatter={(v) => v.toFixed(1)} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
            <Tooltip formatter={(v: unknown) => typeof v === 'number' ? v.toFixed(3) : String(v)} />
            <ReferenceLine x={0} stroke="#6b7280" />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.value >= 0 ? '#22c55e' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="px-3 py-2 font-medium text-gray-600 border border-gray-200">Driver</th>
            <th className="px-3 py-2 font-medium text-gray-600 border border-gray-200 text-right">Contribution</th>
            <th className="px-3 py-2 font-medium text-gray-600 border border-gray-200 text-right">Abs Change</th>
            <th className="px-3 py-2 font-medium text-gray-600 border border-gray-200 text-right">Rel Change</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              <td className="px-3 py-2 border border-gray-200 font-medium">{d.driver}</td>
              <td className={`px-3 py-2 border border-gray-200 text-right font-mono ${(d.contribution ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {(d.contribution ?? 0) >= 0 ? '+' : ''}{(d.contribution ?? 0).toFixed(3)}
              </td>
              <td className="px-3 py-2 border border-gray-200 text-right font-mono text-gray-700">
                {d.absoluteChange != null ? ((d.absoluteChange >= 0 ? '+' : '') + d.absoluteChange.toFixed(2)) : '—'}
              </td>
              <td className="px-3 py-2 border border-gray-200 text-right font-mono text-gray-700">
                {d.relativeChange != null ? ((d.relativeChange >= 0 ? '+' : '') + (d.relativeChange * 100).toFixed(1) + '%') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DriversView({ drivers }: { drivers: CausalDriver[] }) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-gray-50 text-left">
          <th className="px-3 py-2 font-medium text-gray-600 border border-gray-200">Driver</th>
          <th className="px-3 py-2 font-medium text-gray-600 border border-gray-200 text-right">Importance</th>
          <th className="px-3 py-2 font-medium text-gray-600 border border-gray-200">Direction</th>
          <th className="px-3 py-2 font-medium text-gray-600 border border-gray-200 text-right">Effect</th>
          <th className="px-3 py-2 font-medium text-gray-600 border border-gray-200 text-right">p-value</th>
          <th className="px-3 py-2 font-medium text-gray-600 border border-gray-200">Sig.</th>
        </tr>
      </thead>
      <tbody>
        {drivers.map((d, i) => (
          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
            <td className="px-3 py-2 border border-gray-200 font-medium">{d.driver}</td>
            <td className="px-3 py-2 border border-gray-200 text-right font-mono">{d.importance?.toFixed(4) ?? '—'}</td>
            <td className="px-3 py-2 border border-gray-200">
              {d.direction ? (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  d.direction.toLowerCase() === 'positive' ? 'bg-green-100 text-green-800' :
                  d.direction.toLowerCase() === 'negative' ? 'bg-red-100 text-red-800' :
                  'bg-gray-100 text-gray-600'
                }`}>{d.direction}</span>
              ) : '—'}
            </td>
            <td className="px-3 py-2 border border-gray-200 text-right font-mono">{d.effect?.toFixed(4) ?? '—'}</td>
            <td className="px-3 py-2 border border-gray-200 text-right font-mono">{d.pValue?.toFixed(4) ?? '—'}</td>
            <td className="px-3 py-2 border border-gray-200">
              {d.significant != null ? (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${d.significant ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {d.significant ? '✓ Yes' : 'No'}
                </span>
              ) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ValidationView({ tests }: { tests: ValidationTest[] }) {
  return (
    <div className="space-y-3">
      {tests.map((t, i) => (
        <div key={i} className={`rounded-lg border p-4 ${t.passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-sm text-gray-800">{t.test}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${t.passed ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
              {t.passed ? '✓ PASSED' : '✗ FAILED'}
            </span>
          </div>
          {t.description && <p className="text-xs text-gray-600 mb-1">{t.description}</p>}
          <div className="flex gap-4 text-xs text-gray-500 font-mono">
            {t.statistic != null && <span>Statistic: {t.statistic.toFixed(4)}</span>}
            {t.pValue != null && <span>p-value: {t.pValue.toFixed(4)}</span>}
          </div>
          {!t.passed && t.recommendation && (
            <p className="mt-2 text-xs text-red-700 font-medium">💡 {t.recommendation}</p>
          )}
        </div>
      ))}
    </div>
  )
}

function NarrativeView({ sections }: { sections: NarrativeSection[] }) {
  return (
    <div className="space-y-4">
      {sections.map((s, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          {s.section && (
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm text-gray-800">{s.section}</h4>
              {s.confidence && (
                <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">{s.confidence}</span>
              )}
            </div>
          )}
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{s.narrative}</p>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CausalResultArtifact({ artifact }: Props) {
  const data = artifact.data as Record<string, unknown> | null
  if (!data) {
    return <p className="text-sm text-gray-500 italic">No causal data available.</p>
  }

  const subtype = data['subtype'] as string | undefined
  const drivers = (data['drivers'] as CausalDriver[] | undefined) ?? []
  const tests = (data['tests'] as ValidationTest[] | undefined) ?? []
  const sections = (data['sections'] as NarrativeSection[] | undefined) ?? []
  const fullNarrative = data['fullNarrative'] as string | undefined

  // Pipeline: show summary + all available sections
  if (subtype === 'pipeline') {
    const pipelineSections = data['sections'] as Record<string, unknown[]> | undefined
    return (
      <div className="space-y-4">
        {artifact.narrative && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="text-sm text-blue-800">{artifact.narrative}</p>
          </div>
        )}
        {pipelineSections && Object.entries(pipelineSections).map(([key, rows]) => (
          <div key={key}>
            <h4 className="font-semibold text-sm text-gray-700 mb-2 uppercase tracking-wide">{key}</h4>
            <pre className="text-xs text-gray-600 bg-gray-50 rounded border p-3 overflow-auto max-h-48">
              {JSON.stringify(rows, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    )
  }

  // Narrative view
  if (subtype === 'narrative') {
    if (sections.length > 0) return <NarrativeView sections={sections} />
    if (fullNarrative) {
      return (
        <div className="prose prose-sm max-w-none rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
          {fullNarrative}
        </div>
      )
    }
    return <p className="text-sm text-gray-500 italic">No narrative generated.</p>
  }

  // Validation view
  if (subtype === 'validation' && tests.length > 0) {
    const passedCount = data['passedCount'] as number | undefined
    const failedCount = data['failedCount'] as number | undefined
    return (
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="flex-1 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-center">
            <div className="text-2xl font-bold text-green-700">{passedCount ?? 0}</div>
            <div className="text-xs text-green-600 mt-1">Tests Passed</div>
          </div>
          <div className="flex-1 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-center">
            <div className="text-2xl font-bold text-red-700">{failedCount ?? 0}</div>
            <div className="text-xs text-red-600 mt-1">Tests Failed</div>
          </div>
        </div>
        <ValidationView tests={tests} />
      </div>
    )
  }

  // Drivers view
  if (subtype === 'drivers' && drivers.length > 0) {
    const sigCount = data['significantCount'] as number | undefined
    return (
      <div className="space-y-3">
        {sigCount !== undefined && (
          <div className="text-sm text-gray-600">
            <span className="font-semibold text-green-700">{sigCount}</span> statistically significant driver(s) identified.
          </div>
        )}
        <DriversView drivers={drivers} />
      </div>
    )
  }

  // Contribution view (default for CAUSAL_CONTRIBUTION and CAUSAL_AUTO)
  if (drivers.length > 0) {
    const totalContrib = data['totalContribution'] as number | undefined
    return (
      <div className="space-y-3">
        {totalContrib !== undefined && (
          <div className="text-sm text-gray-600">
            Total explained change: <span className="font-semibold font-mono">{totalContrib.toFixed(3)}</span>
          </div>
        )}
        <ContributionView drivers={drivers} />
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
      <p className="text-sm text-gray-600">{artifact.narrative ?? 'Causal analysis complete.'}</p>
    </div>
  )
}
