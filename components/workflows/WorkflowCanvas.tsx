"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
import AgentNode from "./nodes/AgentNode";
import OutputNode from "./nodes/OutputNode";
import { X, Undo2, Redo2 } from "lucide-react";
import { agentPalette, semanticModels } from "@/lib/mock-data";

const nodeTypes = { agentNode: AgentNode, outputNode: OutputNode };

export const edgeDefaults = {
  animated: true,
  style: { stroke: "#1C1A16", strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#1C1A16", width: 16, height: 16 },
};

const DEFAULT_NODES: Node[] = [
  { id: "step-1", type: "agentNode", position: { x: 180, y: 40 }, data: { agentType: "cortex-analyst", label: "Cortex Analyst", stepNumber: 1, prompt: "Show dispensed claims, fill rate, and avg OOP by national plan for last 13 weeks" } },
  { id: "step-2", type: "agentNode", position: { x: 180, y: 220 }, data: { agentType: "clustering", label: "GMM Clustering", stepNumber: 2, prompt: "Features: auto-detect. Segments: auto-detect." } },
  { id: "step-3a", type: "agentNode", position: { x: 40, y: 400 }, data: { agentType: "prophet", label: "Prophet Forecast", stepNumber: 3, prompt: "Segment A — 13-week horizon", runPerSegment: true } },
  { id: "step-3b", type: "agentNode", position: { x: 320, y: 400 }, data: { agentType: "prophet", label: "Prophet Forecast", stepNumber: 4, prompt: "Segment B — 13-week horizon", runPerSegment: true } },
  { id: "output", type: "outputNode", position: { x: 180, y: 580 }, data: {} },
];

const DEFAULT_EDGES: Edge[] = [
  { id: "e1-2", source: "step-1", target: "step-2", ...edgeDefaults },
  { id: "e2-3a", source: "step-2", target: "step-3a", ...edgeDefaults },
  { id: "e2-3b", source: "step-2", target: "step-3b", ...edgeDefaults },
  { id: "e3a-out", source: "step-3a", target: "output", ...edgeDefaults },
  { id: "e3b-out", source: "step-3b", target: "output", ...edgeDefaults },
];

// Compute step numbers via topological BFS
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
    const node = nodes.find((n) => n.id === id);
    if (node?.type === "agentNode") {
      stepMap.set(id, step++);
    }
    for (const child of children.get(id) ?? []) {
      const newDeg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, newDeg);
      if (newDeg <= 0) queue.push(child);
    }
  }
  return stepMap;
}

interface NodeDetailDrawerProps {
  node: Node;
  onClose: () => void;
  onUpdateNode: (id: string, data: Record<string, unknown>) => void;
}

function NodeDetailDrawer({ node, onClose, onUpdateNode }: NodeDetailDrawerProps) {
  const d = node.data as Record<string, unknown>;
  const [prompt, setPrompt] = useState((d.prompt as string) ?? "");
  const [agentType, setAgentType] = useState((d.agentType as string) ?? "cortex-analyst");
  const [outputFormat, setOutputFormat] = useState((d.outputFormat as string) ?? "Full Table");
  const [semanticModelId, setSemanticModelId] = useState((d.semanticModel as string) ?? semanticModels[0].name);

  const handleApply = () => {
    onUpdateNode(node.id, { ...d, prompt, agentType, outputFormat, semanticModel: semanticModelId });
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto" style={{ background: "var(--bg-secondary)", borderLeft: "1px solid var(--border)", width: 270 }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{d.label as string}</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-black/7 transition-colors" style={{ color: "var(--text-muted)" }}>
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-4 p-4 flex-1">
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="w-full rounded-lg px-3 py-2 text-xs resize-none outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Algorithm</label>
          <select
            value={agentType}
            onChange={(e) => setAgentType(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          >
            {agentPalette.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Semantic Model</label>
          <select
            value={semanticModelId}
            onChange={(e) => setSemanticModelId(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          >
            {semanticModels.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>Output Format</label>
          <select
            value={outputFormat}
            onChange={(e) => setOutputFormat(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-xs outline-none"
            style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          >
            <option>Full Table</option>
            <option>Summary Only</option>
            <option>Chart</option>
            <option>Narrative</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-muted)" }}>Input</label>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {node.id === "step-1" ? "None (first step)" : "From upstream step output"}
          </p>
        </div>
        <div className="rounded-lg p-3 text-xs flex flex-col gap-1" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
          <p className="font-medium" style={{ color: "var(--text-muted)" }}>Last Run Result</p>
          <p style={{ color: "var(--success)" }}>Success (1.4s)</p>
          <p style={{ color: "var(--text-secondary)" }}>Rows returned: 12</p>
        </div>
      </div>
      <div className="p-4 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>
        <button
          onClick={handleApply}
          className="w-full py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-90"
          style={{ background: "var(--accent)", color: "white" }}
        >
          Apply Changes
        </button>
      </div>
    </div>
  );
}

// Edge tooltip state
interface EdgeTooltip { x: number; y: number; edgeId: string }

const MAX_HISTORY = 5;

export default function WorkflowCanvas({ startEmpty = false }: { startEmpty?: boolean }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(startEmpty ? [] : DEFAULT_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(startEmpty ? [] : DEFAULT_EDGES);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [edgeTooltip, setEdgeTooltip] = useState<EdgeTooltip | null>(null);

  // Undo/redo history
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

  // Intercept node changes to capture deletions for history
  const onNodesChangeWrapped = useCallback((changes: NodeChange[]) => {
    if (changes.some((c) => c.type === "remove")) {
      pushHistory();
    }
    onNodesChange(changes);
  }, [onNodesChange, pushHistory]);

  // Intercept edge changes to capture deletions for history
  const onEdgesChangeWrapped = useCallback((changes: EdgeChange[]) => {
    if (changes.some((c) => c.type === "remove")) {
      pushHistory();
    }
    onEdgesChange(changes);
  }, [onEdgesChange, pushHistory]);

  // Compute step numbers from topology
  const nodesWithSteps = useMemo(() => {
    const stepMap = computeStepNumbers(nodes, edges);
    return nodes.map((n) =>
      n.type === "agentNode"
        ? { ...n, data: { ...n.data, stepNumber: stepMap.get(n.id) ?? (n.data.stepNumber as number) } }
        : n
    );
  }, [nodes, edges]);

  const onConnect = useCallback(
    (params: Connection) => {
      pushHistory();
      setEdges((eds) => addEdge({ ...params, ...edgeDefaults }, eds));
    },
    [setEdges, pushHistory]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === "agentNode") setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setEdgeTooltip(null);
  }, []);

  // Double-click edge to delete
  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    pushHistory();
    setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    setEdgeTooltip(null);
  }, [setEdges, pushHistory]);

  // Edge hover tooltip
  const onEdgeMouseEnter = useCallback((event: React.MouseEvent, edge: Edge) => {
    setEdgeTooltip({ x: event.clientX, y: event.clientY, edgeId: edge.id });
  }, []);

  const onEdgeMouseLeave = useCallback(() => setEdgeTooltip(null), []);

  // Keyboard delete + undo/redo
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        pushHistory();
        setNodes((nds) => nds.filter((n) => !n.selected));
        setEdges((eds) => eds.filter((ed) => !ed.selected));
        setSelectedNode(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [setNodes, setEdges, pushHistory, undo, redo]);

  const updateNodeData = useCallback((id: string, data: Record<string, unknown>) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data } : n)));
    // Update selected node to reflect new data
    setSelectedNode((prev) => prev && prev.id === id ? { ...prev, data } : prev);
  }, [setNodes]);

  return (
    <div className="flex h-full relative">
      <div className="flex-1 relative">
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
          fitViewOptions={{ padding: 0.3 }}
          defaultEdgeOptions={edgeDefaults}
          deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
          <Controls />
        </ReactFlow>

        {/* Undo / Redo floating controls */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!history.length}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "#ffffff", border: "1px solid var(--border)", color: "var(--text-secondary)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
            title="Undo (⌘Z)"
          >
            <Undo2 size={12} /> Undo
          </button>
          <button
            onClick={redo}
            disabled={!future.length}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors hover:bg-black/5 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "#ffffff", border: "1px solid var(--border)", color: "var(--text-secondary)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
            title="Redo (⌘⇧Z)"
          >
            <Redo2 size={12} /> Redo
          </button>
        </div>

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

      {selectedNode && (
        <NodeDetailDrawer
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onUpdateNode={updateNodeData}
        />
      )}
    </div>
  );
}

export type { Node };
