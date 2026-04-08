"use client";

import { useState } from "react";
import { Handle, Position, NodeProps, useReactFlow } from "@xyflow/react";
import { BarChart3, Layers, TrendingUp, Activity, Cpu, GitFork, FileText, Pencil, Trash2 } from "lucide-react";

// Custom "square → circle" icon for Causal Inference
function CausalIcon({ size = 14, style, strokeWidth = 1.5 }: { size?: number; style?: React.CSSProperties; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={style}
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {/* Square (cause) */}
      <rect x="0.75" y="4" width="5.5" height="5.5" rx="1" strokeWidth={strokeWidth} />
      {/* Arrow shaft + head */}
      <path d="M6.5 6.75 H9.5" strokeWidth={strokeWidth} />
      <path d="M8 5.25 L10 6.75 L8 8.25" strokeWidth={strokeWidth} />
      {/* Circle (effect) */}
      <circle cx="12.5" cy="6.75" r="2.75" strokeWidth={strokeWidth} />
    </svg>
  );
}

type IconComponent = React.FC<{ size?: number; style?: React.CSSProperties; strokeWidth?: number }>;

const AGENT_COLORS: Record<string, string> = {
  "cortex-analyst": "#4f8ef7",
  clustering: "#a78bfa",
  prophet: "#34c98b",
  sarima: "#34c98b",
  "holt-winters": "#34c98b",
  xgboost: "#f5a623",
  hybrid: "#34c98b",
  "auto-forecast": "#2891DA",
  gmm: "#a78bfa",
  kmeans: "#a78bfa",
  kmedoids: "#a78bfa",
  dbscan: "#a78bfa",
  hierarchical: "#a78bfa",
  "auto-cluster": "#2891DA",
  mtree: "#fb923c",
  causal: "#8b5cf6",
  output: "#64748b",
};

const AGENT_ICONS: Record<string, IconComponent> = {
  "cortex-analyst": BarChart3,
  clustering: Layers,
  prophet: TrendingUp,
  sarima: Activity,
  "holt-winters": TrendingUp,
  xgboost: Cpu,
  hybrid: TrendingUp,
  "auto-forecast": TrendingUp,
  gmm: Layers,
  kmeans: Layers,
  kmedoids: Layers,
  dbscan: Layers,
  hierarchical: Layers,
  "auto-cluster": Layers,
  mtree: GitFork,
  causal: CausalIcon,
  output: FileText,
};

export default function AgentNode({ id, data, selected }: NodeProps) {
  const { deleteElements } = useReactFlow();
  const [hovered, setHovered] = useState(false);

  const agentType = (data.agentType as string) ?? "cortex-analyst";
  const color = AGENT_COLORS[agentType] ?? "#4f8ef7";
  const label = (data.label as string) ?? "Agent";
  const prompt = (data.prompt as string) ?? "";
  const stepNumber = (data.stepNumber as string | number) ?? 1;
  const runPerSegment = (data.runPerSegment as boolean) ?? false;
  const semanticModel = (data.semanticModel as string) ?? "";
  const AgentIcon = AGENT_ICONS[agentType] ?? BarChart3;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 210,
        background: "#ffffff",
        border: `2px solid ${selected ? color : "var(--border)"}`,
        boxShadow: selected ? `0 0 0 3px ${color}22` : "0 1px 3px rgba(0,0,0,0.06)",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: `${color}15`, borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <AgentIcon size={13} style={{ color, flexShrink: 0 }} strokeWidth={1.5} />
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-tight" style={{ color }}>STEP {stepNumber}</p>
            <p className="text-xs font-medium leading-tight truncate" style={{ color: "#1C1A16" }}>{label}</p>
          </div>
        </div>

        {/* Hover: edit (bubbles to onNodeClick → opens drawer) + delete */}
        {hovered && (
          <div className="flex items-center gap-0.5 shrink-0 ml-1">
            <button
              className="p-1 rounded hover:bg-black/8 transition-colors"
              style={{ color: "var(--text-muted)" }}
              title="Configure"
              /* No stopPropagation — click bubbles to node → onNodeClick opens drawer */
            >
              <Pencil size={11} />
            </button>
            <button
              className="p-1 rounded hover:bg-red-50 transition-colors"
              style={{ color: "#DC2626" }}
              title="Delete node"
              onClick={handleDelete}
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2.5">
        {semanticModel && (
          <span
            className="inline-block text-xs px-1.5 py-0.5 rounded mb-1.5"
            style={{ background: "rgba(40,145,218,0.08)", color: "#2891DA", fontSize: "10px" }}
          >
            {semanticModel}
          </span>
        )}
        {prompt ? (
          <p className="text-xs leading-relaxed line-clamp-3" style={{ color: "var(--text-secondary)" }}>
            &ldquo;{prompt}&rdquo;
          </p>
        ) : (
          <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>Click to configure…</p>
        )}
        {runPerSegment && (
          <div className="mt-2 flex items-center gap-1 text-xs" style={{ color: "#a78bfa" }}>
            <Activity size={10} />
            <span>Run per segment</span>
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Top} style={{ background: "var(--border)", border: "2px solid #fff", width: 10, height: 10 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: color, border: "2px solid #fff", width: 10, height: 10 }} />
    </div>
  );
}
