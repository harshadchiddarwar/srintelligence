"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Save, Play, Share2, TrendingUp, Layers, GitFork, ChevronDown, ChevronRight, X, Undo2, Redo2, Pencil, Check, Trash2, Activity } from "lucide-react";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
  Node,
  Edge,
  Connection,
  NodeChange,
  EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import AgentNode from "@/components/workflows/nodes/AgentNode";
import OutputNode from "@/components/workflows/nodes/OutputNode";
import { semanticModels, agentPalette } from "@/lib/mock-data";

const nodeTypes = { agentNode: AgentNode, outputNode: OutputNode };

const edgeDefaults = {
  animated: true,
  style: { stroke: "#1C1A16", strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#1C1A16", width: 16, height: 16 },
};

// Custom causal icon (square → circle)
function CausalIcon({ size = 14, style, strokeWidth = 1.5 }: { size?: number; style?: React.CSSProperties; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={style}
      stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.75" y="4" width="5.5" height="5.5" rx="1" strokeWidth={strokeWidth} />
      <path d="M6.5 6.75 H9.5" strokeWidth={strokeWidth} />
      <path d="M8 5.25 L10 6.75 L8 8.25" strokeWidth={strokeWidth} />
      <circle cx="12.5" cy="6.75" r="2.75" strokeWidth={strokeWidth} />
    </svg>
  );
}

type ScheduleType = "daily" | "weekly" | "monthly";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 12 }, (_, i) => String(i === 0 ? 12 : i));
const MINUTES = ["00", "15", "30", "45"];

function ToggleSwitch({ enabled, onChange, labelOff, labelOn }: {
  enabled: boolean; onChange: (v: boolean) => void; labelOff: string; labelOn: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span style={{ color: enabled ? "var(--text-muted)" : "var(--text-primary)", fontWeight: enabled ? 400 : 600 }}>
        {labelOff}
      </span>
      <button
        onClick={() => onChange(!enabled)}
        className="relative inline-flex items-center rounded-full transition-colors shrink-0"
        style={{ width: 36, height: 20, background: enabled ? "#2891DA" : "var(--bg-hover)", border: "1px solid var(--border)" }}
      >
        <span
          className="absolute rounded-full bg-white shadow transition-transform"
          style={{ width: 14, height: 14, left: 2, transform: enabled ? "translateX(16px)" : "translateX(0px)" }}
        />
      </button>
      <span style={{ color: enabled ? "var(--text-primary)" : "var(--text-muted)", fontWeight: enabled ? 600 : 400 }}>
        {labelOn}
      </span>
    </div>
  );
}

function InlineSchedulePicker() {
  const [schedule, setSchedule] = useState<ScheduleType>("daily");
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("00");
  const [ampm, setAmpm] = useState<"AM" | "PM">("AM");
  const [day, setDay] = useState("Mon");
  const [monthDate, setMonthDate] = useState("1");
  const [open, setOpen] = useState(false);

  const label =
    schedule === "daily" ? `Daily · ${hour}:${minute} ${ampm}` :
    schedule === "weekly" ? `Weekly · ${day} ${hour}:${minute} ${ampm}` :
    `Monthly · ${monthDate} · ${hour}:${minute} ${ampm}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors hover:bg-black/5"
        style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
      >
        <span style={{ color: "var(--text-muted)" }}>Schedule:</span>
        <span className="font-medium">{label}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 rounded-xl shadow-xl p-3 flex flex-col gap-2"
          style={{ background: "#ffffff", border: "1px solid var(--border)", minWidth: 260 }}>
          <div className="flex gap-1.5">
            {(["daily", "weekly", "monthly"] as ScheduleType[]).map((s) => (
              <button key={s} onClick={() => setSchedule(s)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors"
                style={{ background: schedule === s ? "#2891DA" : "var(--bg-secondary)", color: schedule === s ? "white" : "var(--text-secondary)" }}>
                {s}
              </button>
            ))}
          </div>
          {schedule === "weekly" && (
            <div className="flex gap-1 flex-wrap">
              {DAYS.map((d) => (
                <button key={d} onClick={() => setDay(d)} className="px-2 py-1 rounded text-xs transition-colors"
                  style={{ background: day === d ? "#2891DA" : "var(--bg-secondary)", color: day === d ? "white" : "var(--text-muted)", border: `1px solid ${day === d ? "#2891DA" : "var(--border)"}` }}>
                  {d}
                </button>
              ))}
            </div>
          )}
          {schedule === "monthly" && (
            <div className="flex gap-1 flex-wrap max-h-20 overflow-y-auto">
              {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((d) => (
                <button key={d} onClick={() => setMonthDate(d)}
                  className="w-6 h-6 rounded text-xs transition-colors flex items-center justify-center"
                  style={{ background: monthDate === d ? "#2891DA" : "var(--bg-secondary)", color: monthDate === d ? "white" : "var(--text-muted)", border: `1px solid ${monthDate === d ? "#2891DA" : "var(--border)"}` }}>
                  {d}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Time:</span>
            <select value={hour} onChange={(e) => setHour(e.target.value)}
              className="rounded px-1.5 py-0.5 text-xs outline-none"
              style={{ border: "1px solid var(--border)", background: "#fff", color: "var(--text-primary)" }}>
              {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>:</span>
            <select value={minute} onChange={(e) => setMinute(e.target.value)}
              className="rounded px-1.5 py-0.5 text-xs outline-none"
              style={{ border: "1px solid var(--border)", background: "#fff", color: "var(--text-primary)" }}>
              {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="flex rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              {(["AM", "PM"] as const).map((p) => (
                <button key={p} onClick={() => setAmpm(p)} className="px-2 py-0.5 text-xs transition-colors"
                  style={{ background: ampm === p ? "#2891DA" : "#fff", color: ampm === p ? "white" : "var(--text-muted)" }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <button onClick={() => setOpen(false)}
            className="text-xs font-medium self-end px-2 py-1 rounded transition-colors hover:bg-black/5"
            style={{ color: "var(--accent)" }}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}

// Agent palette — only the 4 SRI ML agents from CORTEX_TESTING.ML
const AGENT_GROUPS = [
  {
    type: "sri-forecast", label: "Forecast", icon: TrendingUp, color: "#34c98b",
    description: "Time-series demand forecasting",
    algorithms: [
      { type: "prophet",        label: "Prophet" },
      { type: "sarima",         label: "SARIMA" },
      { type: "holt-winters",   label: "Holt-Winters" },
      { type: "xgboost",        label: "XGBoost" },
      { type: "hybrid",         label: "Hybrid (Prophet + XGBoost)" },
      { type: "auto-forecast",  label: "Auto (best fit)" },
    ],
  },
  {
    type: "sri-clustering", label: "Clustering", icon: Layers, color: "#a78bfa",
    description: "Unsupervised segmentation",
    algorithms: [
      { type: "kmeans",       label: "K-Means" },
      { type: "hierarchical", label: "Hierarchical" },
      { type: "dbscan",       label: "DBSCAN" },
      { type: "kmedoids",     label: "K-Medoids" },
      { type: "gmm",          label: "GMM" },
      { type: "auto-cluster", label: "Auto (best fit)" },
    ],
  },
  { type: "sri-mtree",  label: "mTree™",           icon: GitFork,   color: "#fb923c", description: "Driver analysis & waterfall explainability", algorithms: null },
  { type: "sri-causal", label: "Causal Inference",  icon: CausalIcon, color: "#8b5cf6", description: "4-phase causal discovery pipeline", algorithms: null },
];

// Topological step-number computation
function computeStepNumbers(nodes: Node[], edges: Edge[]): Map<string, number> {
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    children.get(e.source)?.push(e.target);
  }
  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const stepMap = new Map<string, number>();
  let step = 1;
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (nodes.find((n) => n.id === id)?.type === "agentNode") stepMap.set(id, step++);
    for (const child of children.get(id) ?? []) {
      const d = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, d);
      if (d <= 0) queue.push(child);
    }
  }
  return stepMap;
}

// NodeDetailDrawer for new workflow
interface NodeDetailDrawerProps {
  node: Node;
  onClose: () => void;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
}

function NodeDetailDrawer({ node, onClose, onUpdateNode }: NodeDetailDrawerProps) {
  const d = node.data as Record<string, unknown>;
  const [prompt, setPrompt] = useState((d.prompt as string) ?? "");
  const [agentType, setAgentType] = useState((d.agentType as string) ?? "sri-forecast");
  const [outputFormat, setOutputFormat] = useState((d.outputFormat as string) ?? "Full Table");
  const [semanticModelId, setSemanticModelId] = useState((d.semanticModel as string) ?? semanticModels[0].name);

  const handleApply = () => {
    onUpdateNode(node.id, { ...d, prompt, agentType, outputFormat, semanticModel: semanticModelId });
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto shrink-0" style={{ background: "var(--bg-secondary)", borderLeft: "1px solid var(--border)", width: 270 }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Configure Node</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-black/7 transition-colors" style={{ color: "var(--text-muted)" }}>
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-4 p-4 flex-1">
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Prompt / Instructions</label>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
            className="w-full rounded-lg px-3 py-2 text-xs resize-none outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Algorithm</label>
          <select value={agentType} onChange={(e) => setAgentType(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
            {agentPalette.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Semantic Model</label>
          <select value={semanticModelId} onChange={(e) => setSemanticModelId(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
            {semanticModels.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Output Format</label>
          <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
            <option>Full Table</option><option>Summary Only</option><option>Chart</option><option>Narrative</option>
          </select>
        </div>
      </div>
      <div className="p-4 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
        <button onClick={handleApply}
          className="w-full py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-90"
          style={{ background: "var(--accent)", color: "white" }}>
          Apply Changes
        </button>
      </div>
    </div>
  );
}

function AgentPalette({ onAdd }: { onAdd: (type: string, label: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="w-60 shrink-0 flex flex-col overflow-y-auto" style={{ borderLeft: "1px solid var(--border)", background: "#ffffff" }}>
      <div className="px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Agent Palette</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Click an agent to add</p>
      </div>
      <div className="flex flex-col p-2 gap-1 flex-1 overflow-y-auto">
        {AGENT_GROUPS.map((agent) => {
          const Icon = agent.icon;
          const isExpanded = expanded === agent.type;
          return (
            <div key={agent.type}>
              <button
                onClick={() => agent.algorithms ? setExpanded(isExpanded ? null : agent.type) : onAdd(agent.type, agent.label)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-black/5"
                style={{ border: "1px solid var(--border)" }}
              >
                <span className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ background: `${agent.color}15` }}>
                  <Icon size={14} style={{ color: agent.color }} strokeWidth={1.5} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{agent.label}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{agent.description}</p>
                </div>
                {agent.algorithms && (isExpanded
                  ? <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
                  : <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />)}
              </button>
              {agent.algorithms && isExpanded && (
                <div className="ml-4 mt-1 flex flex-col gap-1 mb-1">
                  {agent.algorithms.map((algo) => (
                    <button key={algo.type} onClick={() => onAdd(algo.type, `${agent.label} · ${algo.label}`)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors hover:bg-black/5"
                      style={{ border: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: algo.label === "Auto (best fit)" ? "#2891DA" : agent.color }} />
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{algo.label}</span>
                      {algo.label === "Auto (best fit)" && (
                        <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full"
                          style={{ background: "rgba(40,145,218,0.1)", color: "#2891DA", fontSize: "9px" }}>
                          Recommended
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MAX_HISTORY = 5;

export default function NewWorkflowPage() {
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [workflowName, setWorkflowName] = useState("New Workflow");
  const [editingName, setEditingName] = useState(false);
  const [nameHovered, setNameHovered] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // Undo/redo
  const [history, setHistory] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const [future, setFuture] = useState<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), { nodes: nodesRef.current, edges: edgesRef.current }]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [{ nodes: nodesRef.current, edges: edgesRef.current }, ...f.slice(0, MAX_HISTORY - 1)]);
      setNodes(prev.nodes);
      setEdges(prev.edges);
      return h.slice(0, -1);
    });
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), { nodes: nodesRef.current, edges: edgesRef.current }]);
      setNodes(next.nodes);
      setEdges(next.edges);
      return f.slice(1);
    });
  }, [setNodes, setEdges]);

  const onNodesChangeWrapped = useCallback((changes: NodeChange[]) => {
    if (changes.some((c) => c.type === "remove")) { pushHistory(); setIsDirty(true); }
    onNodesChange(changes);
  }, [onNodesChange, pushHistory]);

  const onEdgesChangeWrapped = useCallback((changes: EdgeChange[]) => {
    if (changes.some((c) => c.type === "remove")) { pushHistory(); setIsDirty(true); }
    onEdgesChange(changes);
  }, [onEdgesChange, pushHistory]);

  // Step numbers from topology
  const nodesWithSteps = useMemo(() => {
    const stepMap = computeStepNumbers(nodes, edges);
    return nodes.map((n) =>
      n.type === "agentNode"
        ? { ...n, data: { ...n.data, stepNumber: stepMap.get(n.id) ?? (n.data.stepNumber as number) } }
        : n
    );
  }, [nodes, edges]);

  const onConnect = useCallback((params: Connection) => {
    pushHistory();
    setEdges((eds) => addEdge({ ...params, ...edgeDefaults }, eds));
    setIsDirty(true);
  }, [setEdges, pushHistory]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === "agentNode") setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    pushHistory();
    setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    setIsDirty(true);
  }, [setEdges, pushHistory]);

  const [edgeTooltip, setEdgeTooltip] = useState<{ x: number; y: number } | null>(null);
  const onEdgeMouseEnter = useCallback((event: React.MouseEvent) => {
    setEdgeTooltip({ x: event.clientX, y: event.clientY });
  }, []);
  const onEdgeMouseLeave = useCallback(() => setEdgeTooltip(null), []);

  const handleAddAgent = (type: string, label: string) => {
    pushHistory();
    const newNode: Node = {
      id: `node-${Date.now()}`,
      type: "agentNode",
      position: { x: 160 + (nodes.length % 2) * 240, y: Math.floor(nodes.length / 2) * 210 + 40 },
      data: { agentType: type, label, stepNumber: nodes.length + 1, prompt: "" },
    };
    setNodes((nds) => [...nds, newNode]);
    setIsDirty(true);
  };

  const updateNodeData = useCallback((id: string, data: Record<string, unknown>) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data } : n)));
    setSelectedNode((prev) => prev?.id === id ? { ...prev, data } : prev);
  }, [setNodes]);

  const handleBack = () => {
    if (isDirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    router.push("/workflows");
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        pushHistory();
        setNodes((nds) => nds.filter((n) => !n.selected));
        setEdges((eds) => eds.filter((ed) => !ed.selected));
        setSelectedNode(null);
        setIsDirty(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [setNodes, setEdges, pushHistory, undo, redo]);

  return (
    <div className="flex flex-col h-full" style={{ background: "#ffffff" }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 shrink-0"
        style={{ borderBottom: "1px solid var(--border)", background: "#ffffff" }}>

        {/* Editable workflow name with hover rename */}
        <div
          className="flex items-center gap-1.5 group"
          onMouseEnter={() => setNameHovered(true)}
          onMouseLeave={() => setNameHovered(false)}
        >
          {editingName ? (
            <>
              <input
                autoFocus
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditingName(false); }}
                onBlur={() => setEditingName(false)}
                className="bg-transparent text-sm font-semibold outline-none pb-0.5"
                style={{ color: "var(--text-primary)", minWidth: 160, borderBottom: "1px solid rgba(0,0,0,0.2)" }}
              />
              <button onClick={() => setEditingName(false)} className="p-0.5 rounded" style={{ color: "var(--accent)" }}>
                <Check size={12} />
              </button>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{workflowName}</span>
              {nameHovered && (
                <button onClick={() => setEditingName(true)}
                  className="p-0.5 rounded hover:bg-black/5 transition-colors"
                  style={{ color: "var(--text-muted)" }}>
                  <Pencil size={11} />
                </button>
              )}
            </>
          )}
        </div>

        <div style={{ width: 1, height: 24, background: "var(--border)" }} className="shrink-0" />

        {/* Toggle */}
        <ToggleSwitch enabled={autoUpdate} onChange={setAutoUpdate} labelOff="Manual-Update" labelOn="Auto-Update" />
        {autoUpdate && <InlineSchedulePicker />}

        <div className="flex-1" />

        {/* Actions: Back · Run · Save · Share */}
        <div className="flex items-center gap-2">
          {/* Undo / Redo */}
          <button onClick={undo} disabled={!history.length}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }} title="Undo">
            <Undo2 size={12} />
          </button>
          <button onClick={redo} disabled={!future.length}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }} title="Redo">
            <Redo2 size={12} />
          </button>

          <div style={{ width: 1, height: 20, background: "var(--border)" }} />

          <button onClick={handleBack}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
            Back
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-90"
            style={{ background: "var(--accent)", color: "white" }}>
            <Play size={11} fill="white" />
            Run
          </button>
          <button onClick={() => setIsDirty(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
            <Save size={11} />
            Save
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
            <Share2 size={11} />
            Share
          </button>
        </div>
      </div>

      {/* Canvas + right palette */}
      <div className="flex-1 overflow-hidden flex">
        {/* Canvas */}
        <div className="flex-1 relative">
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
              <div className="text-center">
                <p className="text-sm font-medium mb-1" style={{ color: "var(--text-muted)" }}>Blank Canvas</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Click an agent in the panel →</p>
              </div>
            </div>
          )}
          <ReactFlow
            nodes={nodesWithSteps}
            edges={edges}
            onNodesChange={onNodesChangeWrapped}
            onEdgesChange={onEdgesChangeWrapped}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onEdgeMouseEnter={onEdgeMouseEnter}
            onEdgeMouseLeave={onEdgeMouseLeave}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.4 }}
            defaultEdgeOptions={edgeDefaults}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
            <Controls />
          </ReactFlow>

          {/* Edge tooltip */}
          {edgeTooltip && (
            <div className="fixed z-50 pointer-events-none px-2 py-1 rounded text-xs shadow-md"
              style={{ left: edgeTooltip.x + 12, top: edgeTooltip.y - 28, background: "#1C1A16", color: "#fff" }}>
              Double-click to delete
            </div>
          )}
        </div>

        {/* Config pane when node selected */}
        {selectedNode ? (
          <NodeDetailDrawer node={selectedNode} onClose={() => setSelectedNode(null)} onUpdateNode={updateNodeData} />
        ) : (
          <AgentPalette onAdd={handleAddAgent} />
        )}
      </div>
    </div>
  );
}
