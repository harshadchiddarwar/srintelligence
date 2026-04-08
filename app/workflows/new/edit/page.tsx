"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Save, Play, Share2, BarChart3, TrendingUp, Layers, GitFork, BarChart2, ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import AgentNode from "@/components/workflows/nodes/AgentNode";
import OutputNode from "@/components/workflows/nodes/OutputNode";
import { semanticModels } from "@/lib/mock-data";

const nodeTypes = { agentNode: AgentNode, outputNode: OutputNode };

const edgeDefaults = {
  animated: true,
  style: { stroke: "#1C1A16", strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#1C1A16", width: 16, height: 16 },
};

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
        <div
          className="absolute top-full left-0 mt-1 z-30 rounded-xl shadow-xl p-3 flex flex-col gap-2"
          style={{ background: "#ffffff", border: "1px solid var(--border)", minWidth: 260 }}
        >
          <div className="flex gap-1.5">
            {(["daily", "weekly", "monthly"] as ScheduleType[]).map((s) => (
              <button
                key={s}
                onClick={() => setSchedule(s)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors"
                style={{
                  background: schedule === s ? "#2891DA" : "var(--bg-secondary)",
                  color: schedule === s ? "white" : "var(--text-secondary)",
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {schedule === "weekly" && (
            <div className="flex gap-1 flex-wrap">
              {DAYS.map((d) => (
                <button key={d} onClick={() => setDay(d)}
                  className="px-2 py-1 rounded text-xs transition-colors"
                  style={{
                    background: day === d ? "#2891DA" : "var(--bg-secondary)",
                    color: day === d ? "white" : "var(--text-muted)",
                    border: `1px solid ${day === d ? "#2891DA" : "var(--border)"}`,
                  }}>
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
                  style={{
                    background: monthDate === d ? "#2891DA" : "var(--bg-secondary)",
                    color: monthDate === d ? "white" : "var(--text-muted)",
                    border: `1px solid ${monthDate === d ? "#2891DA" : "var(--border)"}`,
                  }}>
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
                <button key={p} onClick={() => setAmpm(p)}
                  className="px-2 py-0.5 text-xs transition-colors"
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

// Agent palette with full algorithm lists
const AGENT_GROUPS = [
  {
    type: "cortex-analyst",
    label: "Analyst",
    icon: BarChart3,
    color: "#4f8ef7",
    description: "SQL queries against Snowflake",
    algorithms: null,
  },
  {
    type: "forecasting",
    label: "Forecasting",
    icon: TrendingUp,
    color: "#34c98b",
    description: "Time-series forecasting",
    algorithms: [
      { type: "prophet", label: "Prophet" },
      { type: "sarima", label: "SARIMA" },
      { type: "holt-winters", label: "Holt-Winters" },
      { type: "xgboost", label: "XGBoost" },
      { type: "hybrid", label: "Hybrid" },
      { type: "auto-forecast", label: "Auto (best fit)" },
    ],
  },
  {
    type: "clustering",
    label: "Clustering",
    icon: Layers,
    color: "#a78bfa",
    description: "Unsupervised segmentation",
    algorithms: [
      { type: "gmm", label: "GMM" },
      { type: "kmeans", label: "K-Means" },
      { type: "kmedoids", label: "K-Medoids" },
      { type: "dbscan", label: "DBScan" },
      { type: "hierarchical", label: "Hierarchical" },
      { type: "auto-cluster", label: "Auto (best fit)" },
    ],
  },
  {
    type: "mtree",
    label: "Decision Tree",
    icon: GitFork,
    color: "#fb923c",
    description: "Driver analysis & explainability",
    algorithms: null,
  },
  {
    type: "causal",
    label: "Causal Inference",
    icon: BarChart2,
    color: "#8b5cf6",
    description: "Causal effect estimation",
    algorithms: null,
  },
];

function AgentPalette({ onAdd }: { onAdd: (type: string, label: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div
      className="w-64 shrink-0 flex flex-col overflow-y-auto"
      style={{ borderLeft: "1px solid var(--border)", background: "#ffffff" }}
    >
      <div
        className="px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Agent Palette</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Click an agent to add to canvas</p>
      </div>
      <div className="flex flex-col p-2 gap-1">
        {AGENT_GROUPS.map((agent) => {
          const Icon = agent.icon;
          const isExpanded = expanded === agent.type;
          return (
            <div key={agent.type}>
              <button
                onClick={() => {
                  if (agent.algorithms) {
                    setExpanded(isExpanded ? null : agent.type);
                  } else {
                    onAdd(agent.type, agent.label);
                  }
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-black/5"
                style={{ border: "1px solid var(--border)" }}
              >
                <span
                  className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
                  style={{ background: `${agent.color}15` }}
                >
                  <Icon size={14} style={{ color: agent.color }} strokeWidth={1.5} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{agent.label}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{agent.description}</p>
                </div>
                {agent.algorithms && (
                  isExpanded
                    ? <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
                    : <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />
                )}
              </button>

              {agent.algorithms && isExpanded && (
                <div className="ml-4 mt-1 flex flex-col gap-1 mb-1">
                  {agent.algorithms.map((algo) => (
                    <button
                      key={algo.type}
                      onClick={() => onAdd(algo.type, `${agent.label} · ${algo.label}`)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors hover:bg-black/5"
                      style={{ border: "1px solid var(--border)", background: "var(--bg-secondary)" }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: algo.label === "Auto (best fit)" ? "#2891DA" : agent.color }}
                      />
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{algo.label}</span>
                      {algo.label === "Auto (best fit)" && (
                        <span
                          className="ml-auto text-xs px-1.5 py-0.5 rounded-full"
                          style={{ background: "rgba(40,145,218,0.1)", color: "#2891DA", fontSize: "9px" }}
                        >
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

      {/* Semantic model selector */}
      <div className="mt-auto p-3" style={{ borderTop: "1px solid var(--border)" }}>
        <p className="text-xs font-medium mb-1.5" style={{ color: "var(--text-muted)" }}>Semantic Model</p>
        <select
          className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
          style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        >
          {semanticModels.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>Applied to all analyst nodes</p>
      </div>
    </div>
  );
}

export default function NewWorkflowPage() {
  const router = useRouter();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [workflowName, setWorkflowName] = useState("New Workflow");
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, ...edgeDefaults }, eds));
      setIsDirty(true);
    },
    [setEdges]
  );

  const handleAddAgent = (type: string, label: string) => {
    const newNode: Node = {
      id: `node-${Date.now()}`,
      type: "agentNode",
      position: { x: 160 + (nodes.length % 2) * 240, y: Math.floor(nodes.length / 2) * 210 + 40 },
      data: { agentType: type, label, stepNumber: nodes.length + 1, prompt: "" },
    };
    setNodes((nds) => [...nds, newNode]);
    setIsDirty(true);
  };

  const handleBack = () => {
    if (isDirty) {
      const confirmed = window.confirm("You have unsaved changes. Leave without saving?");
      if (!confirmed) return;
    }
    router.push("/workflows");
  };

  // Mark dirty when nodes/edges change (after initial render)
  useEffect(() => {
    if (nodes.length > 0 || edges.length > 0) setIsDirty(true);
  }, [nodes.length, edges.length]);

  return (
    <div className="flex flex-col h-full" style={{ background: "#ffffff" }}>
      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 shrink-0"
        style={{ borderBottom: "1px solid var(--border)", background: "#ffffff" }}
      >
        {/* Back button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-black/5"
          style={{ color: "var(--text-muted)" }}
          title="Back to Workflows"
        >
          <ArrowLeft size={13} />
          <span>Back</span>
        </button>

        <div style={{ width: 1, height: 24, background: "var(--border)" }} className="shrink-0" />

        {/* Editable workflow name */}
        <div className="group relative">
          <input
            value={workflowName}
            onChange={(e) => { setWorkflowName(e.target.value); setIsDirty(true); }}
            className="bg-transparent text-sm font-semibold outline-none pb-0.5 transition-colors"
            style={{
              color: "var(--text-primary)",
              minWidth: 160,
              borderBottom: "1px solid transparent",
            }}
            onFocus={(e) => (e.target.style.borderBottomColor = "rgba(0,0,0,0.2)")}
            onBlur={(e) => (e.target.style.borderBottomColor = "transparent")}
          />
        </div>

        <div style={{ width: 1, height: 24, background: "var(--border)" }} className="shrink-0" />

        {/* Auto-update toggle */}
        <ToggleSwitch
          enabled={autoUpdate}
          onChange={setAutoUpdate}
          labelOff="Manual"
          labelOn="Auto-update"
        />

        {/* Schedule picker — only when auto-update */}
        {autoUpdate && <InlineSchedulePicker />}

        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-90"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Play size={11} fill="white" />
            Run
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            onClick={() => setIsDirty(false)}
          >
            <Save size={11} />
            Save
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
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
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>Click an agent in the panel to add it →</p>
              </div>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.4 }}
            defaultEdgeOptions={edgeDefaults}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
            <Controls />
          </ReactFlow>
        </div>

        {/* Right panel: agent palette */}
        <AgentPalette onAdd={handleAddAgent} />
      </div>
    </div>
  );
}
