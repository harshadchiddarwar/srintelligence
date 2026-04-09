"use client"

import type { ConversationMessage } from '../../types/agent'
import ArtifactRenderer from '../artifacts/ArtifactRenderer'
import CacheBadge from './CacheBadge'
import LineageLink from './LineageLink'
import FeedbackButtons from './FeedbackButtons'

interface Props {
  message: ConversationMessage & {
    artifacts?: import('../../types/agent').AgentArtifact[]
    suggestions?: string[]
  }
  onFollowup?: (q: string) => void
}

/** Very simple markdown-like inline renderer: **bold**, _italic_, bullet lists */
function InlineMarkdown({ text }: { text: string }) {
  // Split on newlines first to handle bullet lists
  const lines = text.split('\n')
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((line, li) => {
        // Bullet list
        if (line.trimStart().startsWith('- ') || line.trimStart().startsWith('* ')) {
          return (
            <div key={li} className="flex items-start gap-2">
              <span className="mt-1 shrink-0 text-gray-400">•</span>
              <span>{renderInline(line.replace(/^[\s\-\*]+/, ''))}</span>
            </div>
          )
        }
        if (line === '') return <div key={li} className="h-1.5" />
        return <p key={li}>{renderInline(line)}</p>
      })}
    </div>
  )
}

function renderInline(text: string): React.ReactNode {
  // Split on **bold** and _italic_ patterns
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    return part
  })
}

export default function MessageRenderer({ message, onFollowup }: Props) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-xl rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-3 text-sm text-white shadow-sm">
          {message.content}
        </div>
      </div>
    )
  }

  // Agent / assistant message
  const artifacts = message.artifacts ?? []
  const suggestions = message.suggestions ?? []

  // Gather lineage / cache from first artifact that has them
  const firstArtifact = artifacts[0]
  const lineageId = firstArtifact?.lineageId
  const cacheStatus = firstArtifact?.cacheStatus
  const agentName = firstArtifact?.agentName ?? 'Agent'

  return (
    <div className="flex items-start gap-3">
      {/* AI Avatar — gradient circle, two white sparkles */}
      <div
        className="shrink-0 mt-0.5 flex h-8 w-8 items-center justify-center rounded-full"
        style={{ background: "linear-gradient(135deg, #2891DA 0%, #C8956A 100%)", boxShadow: "0 1px 3px rgba(0,0,0,0.18)" }}
      >
        <svg width="19" height="19" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.5 1 L8.1 6.4 L13.5 8 L8.1 9.6 L6.5 15 L4.9 9.6 L0 8 L4.9 6.4 Z" fill="white" />
          <path d="M13.5 1.5 L14 3 L15.5 3.5 L14 4 L13.5 5.5 L13 4 L11.5 3.5 L13 3 Z" fill="white" />
        </svg>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {/* Text content */}
        {message.content && (
          <div className="text-sm text-gray-800 leading-relaxed">
            <InlineMarkdown text={message.content} />
          </div>
        )}

        {/* Artifacts */}
        {artifacts.length > 0 && (
          <div className="flex flex-col gap-3">
            {artifacts.map((artifact, i) => (
              <div key={artifact.lineageId ?? i} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                {artifact.agentName && (
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    {artifact.agentName}
                  </p>
                )}
                <ArtifactRenderer artifact={artifact} />
                {/* Per-artifact narrative if present */}
                {artifact.narrative && (
                  <p className="mt-3 text-xs text-gray-600 leading-relaxed border-t border-gray-100 pt-2">
                    {artifact.narrative}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Meta row: cache badge, lineage, feedback */}
        {(cacheStatus || lineageId) && (
          <div className="flex items-center gap-3 flex-wrap">
            <CacheBadge cacheStatus={cacheStatus === 'hit' ? 'hit' : cacheStatus === 'bypassed' ? 'bypass' : 'miss'} />
            <LineageLink lineageId={lineageId} />
            {lineageId && (
              <FeedbackButtons
                lineageId={lineageId}
                agentName={agentName}
              />
            )}
          </div>
        )}

        {/* Suggested follow-ups */}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onFollowup?.(s)}
                className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
