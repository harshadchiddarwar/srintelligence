"use client"

import type { AgentArtifact } from '../../types/agent'
import SQLArtifact from './SQLArtifact'
import DataTableArtifact from './DataTableArtifact'
import ForecastArtifact from './ForecastArtifact'
import ForecastCompareArtifact from './ForecastCompareArtifact'
import DecisionTreeArtifact from './DecisionTreeArtifact'
import WaterfallArtifact from './WaterfallArtifact'
import ClusterProfileArtifact from './ClusterProfileArtifact'
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface Props {
  artifact: AgentArtifact
}

// Simple generic chart renderer for artifact.type === 'chart'
function GenericChart({ artifact }: Props) {
  const rows = Array.isArray(artifact.data) ? artifact.data as Record<string, unknown>[] : []
  if (rows.length === 0) {
    return <p className="text-sm text-gray-500 italic">No chart data available.</p>
  }
  const keys = Object.keys(rows[0] ?? {})
  const xKey = keys[0] ?? 'name'
  const valueKeys = keys.slice(1)

  const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4']

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          {valueKeys.map((k, i) => (
            <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Narrative block renderer
function NarrativeArtifact({ artifact }: Props) {
  const text = typeof artifact.data === 'string' ? artifact.data : JSON.stringify(artifact.data)
  return (
    <div className="prose prose-sm max-w-none rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
      {text}
    </div>
  )
}

// Error display
function ErrorArtifact({ artifact }: Props) {
  const message =
    typeof artifact.data === 'string'
      ? artifact.data
      : (artifact.data as { message?: string })?.message ?? JSON.stringify(artifact.data)
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm font-semibold text-red-700 mb-1">Error</p>
      <p className="text-sm text-red-600 font-mono">{message}</p>
    </div>
  )
}

// Fallback — pretty-printed JSON
function JsonArtifact({ artifact }: Props) {
  return (
    <pre className="overflow-auto rounded-lg border border-gray-200 bg-gray-900 text-gray-100 text-xs p-4 max-h-96">
      {JSON.stringify(artifact.data, null, 2)}
    </pre>
  )
}

export default function ArtifactRenderer({ artifact }: Props) {
  // Derive an artifact "type" from the intent when no explicit type property is present.
  // The AgentArtifact type in this codebase doesn't carry a `type` field on the top level —
  // we infer from the intent and data shape instead.
  const intent = artifact.intent

  // Check data shape to infer type
  const data = artifact.data as Record<string, unknown> | null

  // Explicit type hint stored in data (some agents write { _type: 'table', ... })
  const explicitType = data && typeof data === 'object' && '_type' in data
    ? (data as { _type?: string })._type
    : undefined

  const resolvedType = explicitType ?? inferType(intent, data)

  switch (resolvedType) {
    case 'sql':
      return <SQLArtifact artifact={artifact} />
    case 'table':
      return <DataTableArtifact artifact={artifact} />
    case 'forecast':
      return <ForecastArtifact artifact={artifact} />
    case 'comparison':
      return <ForecastCompareArtifact artifact={artifact} />
    case 'tree':
      return <DecisionTreeArtifact artifact={artifact} />
    case 'waterfall':
      return <WaterfallArtifact artifact={artifact} />
    case 'cluster_profile':
      return <ClusterProfileArtifact artifact={artifact} />
    case 'chart':
      return <GenericChart artifact={artifact} />
    case 'narrative':
      return <NarrativeArtifact artifact={artifact} />
    case 'error':
      return <ErrorArtifact artifact={artifact} />
    default:
      // If data is a plain array of objects, render as table
      if (Array.isArray(artifact.data) && artifact.data.length > 0 && typeof artifact.data[0] === 'object') {
        return <DataTableArtifact artifact={artifact} />
      }
      return <JsonArtifact artifact={artifact} />
  }
}

function inferType(
  intent: string,
  data: Record<string, unknown> | unknown[] | null | undefined,
): string {
  if (!data) return 'narrative'

  // Forecast intents
  if (
    intent === 'FORECAST_PROPHET' ||
    intent === 'FORECAST_SARIMA' ||
    intent === 'FORECAST_HW' ||
    intent === 'FORECAST_XGB' ||
    intent === 'FORECAST_AUTO'
  ) {
    return 'forecast'
  }
  if (intent === 'FORECAST_COMPARE') return 'comparison'
  if (intent === 'MTREE') return 'tree'
  if (intent === 'CLUSTER') return 'cluster_profile'

  // Data shape hints
  if (Array.isArray(data)) return 'table'
  const d = data as Record<string, unknown>
  if ('historical' in d && 'forecast' in d) return 'forecast'
  if ('models' in d && 'winner' in d) return 'comparison'
  if ('drivers' in d) return 'tree'
  if ('items' in d && 'baseline' in d) return 'waterfall'
  if ('segments' in d) return 'cluster_profile'
  if ('sql' in d) return 'sql'

  return 'table'
}
