"use client";

import { useState, useCallback, useEffect } from "react";
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
import AgentNode from "./nodes/AgentNode";
import OutputNode from "./nodes/OutputNode";
import { X } from "lucide-react";
import { agentPalette } from "@/lib/mock-data";

const nodeTypes = { agentNode: AgentNode, outputNode: OutputNode };

export const edgeDefaults = {
  animated: true,
  style: { stroke: "#1C1A16", strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#1C1A16", width: 16, height: 16 },
};

const DEFAULT_NODES: Node[] = [
  { id: "step-1", type: "agentNode", position: { x: 180, y: 40 }, data: { agentType: "cortex-analyst", label: "Cortex Analyst", stepNumber: 1, prompt: "Show dispensed claims, fill rate, and avg OOP by national plan for last 13 weeks" } },
  { id: "step-2", type: "agentNode", position: { x: 180, y: 220 }, data: { agentType: "clustering", label: "GMM Clustering", stepNumber: 2, prompt: "Features: auto-detect. Segments: auto-detect." } },
  { id: "step-3a", type: "agentNode", position: { x: 40, y: 400 }, data: { agentType: "prophet", label: "Prophet Forecast", stepNumber: "3a", prompt: "Segment A — 13-week horizon", runPerSegment: true } },
  { id: "step-3b", type: "agentNode", position: { x: 320, y: 400 }, data: { agentType: "prophet", label: "Prophet Forecast", stepNumber: "3b", prompt: "Segment B — 13-week horizon", runPerSegment: true } },
  { id: "output", type: "outputNode", position: { x: 180, y: 580 }, data: {} },
];

const DEFAULT_EDGES: Edge[] = [
  { id: "e1-2", source: "step-1", target: "step-2", ...edgeDefaults },
  { id: "e2-3a", source: "step-2", target: "step-3a", ...edgeDefaults },
  { id: "e2-3b", source: "step-2", target: "step-3b", ...edgeDefaults },
  { id: "e3a-out", source: "step-3a", target: "output", ...edgeDefaults },
  { id: "e3b-out", source: "step-3b", target: "output", ...edgeDefaults },
];

function NodeDetailDrawer({ node, onClose }: { node: Node; onClose: () => void }) {
  const d = node.data as Record<string, unknown>;
  return (
    <div className="h-full flex flex-col overflow-y-auto" style={{ background: "var(--bg-secondary)", borderLeft: "1px solid var(--border)", width: 260 }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{d.label as string}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-black/7 transition-colors" style={{ color: "var(--text-muted)" }}>
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Prompt</label>
          <textarea defaultValue={(d.prompt as string) ?? ""} rows={4} className="w-full rounded-lg px-3 py-2 text-xs resize-none outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Agent</label>
          <select defaultValue={(d.agentType as string) ?? "cortex-analyst"} className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
            {agentPalette.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-muted)" }}>Input</label>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{node.id === "step-1" ? "None (first step)" : "From upstream step output"}</p>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Output Format</label>
          <select className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
            <option>Full Table</option><option>Summary Only</option><option>Chart</option><option>Narrative</option>
          </select>
        </div>
        <div className="rounded-lg p-3 text-xs flex flex-col gap-1" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
          <p className="font-medium" style={{ color: "var(--text-muted)" }}>Last Run Result</p>
          <p style={{ color: "var(--success)" }}>Success (1.4s)</p>
          <p style={{ color: "var(--text-secondary)" }}>Rows returned: 12</p>
        </div>
      </div>
    </div>
  );
}

// Edge tooltip state
interface EdgeTooltip { x: number; y: number; edgeId: string }

export default function WorkflowCanvas({ startEmpty = false }: { startEmpty?: boolean }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(startEmpty ? [] : DEFAULT_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(startEmpty ? [] : DEFAULT_EDGES);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<EdgeTooltip | null>(null);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, ...edgeDefaults }, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => setSelectedNode(node), []);
  const onPaneClick = useCallback(() => { setSelectedNode(null); setEdgeTooltip(null); }, []);

  // Double-click edge to delete it
  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    setEdgeTooltip(null);
  }, [setEdges]);

  // Show tooltip on edge hover
  const onEdgeMouseEnter = useCallback((event: React.MouseEvent, _edge: Edge) => {
    setEdgeTooltip({ x: event.clientX, y: event.clientY, edgeId: _edge.id });
  }, []);

  const onEdgeMouseLeave = useCallback(() => setEdgeTooltip(null), []);

  // Keyboard delete
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        setNodes((nds) => nds.filter((n) => !n.selected));
        setEdges((eds) => eds.filter((ed) => !ed.selected));
        setSelectedNode(null);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [setNodes, setEdges]);

  const addNode = (agentType: string, label: string) => {
    const newNode: Node = {
      id: `step-${Date.now()}`,
      type: "agentNode",
      position: { x: 180, y: nodes.length * 180 + 40 },
      data: { agentType, label, stepNumber: nodes.length + 1, prompt: "" },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  return (
    <div className="flex h-full relative">
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onEdgeDoubleClick={onEdgeDoubleClick}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          defaultEdgeOptions={edgeDefaults}
          deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
          <Controls />
        </ReactFlow>

        {/* Edge hover tooltip */}
        {edgeTooltip && (
          <div
            className="fixed z-50 pointer-events-none px-2 py-1 rounded text-xs shadow-md"
            style={{ left: edgeTooltip.x + 12, top: edgeTooltip.y - 28, background: "#1C1A16", color: "#fff" }}
          >
            Double-click to delete
          </div>
        )}
      </div>

      {selectedNode && <NodeDetailDrawer node={selectedNode} onClose={() => setSelectedNode(null)} />}
    </div>
  );
}

export type { Node };
