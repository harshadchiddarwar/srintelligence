"use client"

export type StatusType =
  | 'classifying'
  | 'routing'
  | 'preparing_data'
  | 'executing'
  | 'formatting'
  | 'complete'
  | 'error'

interface Props {
  type: StatusType
  agentName?: string
  progress?: string
}

const STATUS_CONFIG: Record<
  StatusType,
  { label: string; dot: string; text: string; bg: string; border: string; pulse: boolean }
> = {
  classifying: {
    label: 'Classifying',
    dot: 'bg-blue-500',
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    pulse: true,
  },
  routing: {
    label: 'Routing',
    dot: 'bg-blue-500',
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    pulse: true,
  },
  preparing_data: {
    label: 'Preparing data',
    dot: 'bg-violet-500',
    text: 'text-violet-700',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    pulse: true,
  },
  executing: {
    label: 'Executing',
    dot: 'bg-amber-500',
    text: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    pulse: true,
  },
  formatting: {
    label: 'Formatting',
    dot: 'bg-sky-500',
    text: 'text-sky-700',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
    pulse: true,
  },
  complete: {
    label: 'Complete',
    dot: 'bg-green-500',
    text: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-200',
    pulse: false,
  },
  error: {
    label: 'Error',
    dot: 'bg-red-500',
    text: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    pulse: false,
  },
}

export default function StatusPill({ type, agentName, progress }: Props) {
  const cfg = STATUS_CONFIG[type]

  const label = agentName
    ? `${cfg.label} · ${agentName}`
    : cfg.label

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${cfg.bg} ${cfg.border} ${cfg.text}`}
    >
      {/* Pulsing dot */}
      <span className="relative flex h-2 w-2 shrink-0">
        {cfg.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${cfg.dot} opacity-75`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg.dot}`} />
      </span>

      <span>{label}</span>

      {progress && (
        <span className="opacity-70">— {progress}</span>
      )}
    </div>
  )
}
