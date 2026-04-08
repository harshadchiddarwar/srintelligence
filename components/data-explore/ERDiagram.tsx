"use client";

import { useState, useRef, useCallback } from "react";
import { SemanticTable } from "@/lib/types";

interface ERDiagramProps {
  tables: SemanticTable[];
  selectedTable: string | null;
  onSelectTable: (id: string) => void;
}

const TABLE_HEADER_COLORS: Record<string, string> = {
  "rx-table": "#2891DA",
  "drug-table": "#059669",
  "phys-ref": "#D97706",
  plan: "#7C3AED",
  "hcp-table": "#2891DA",
  territory: "#059669",
  "access-table": "#D97706",
  formulary: "#7C3AED",
};

// Get join key column names that are relevant to a table
function getJoinKeyColumns(table: SemanticTable, allTables: SemanticTable[]): string[] {
  const keys = new Set<string>();
  // Keys from this table's outgoing relations
  for (const rel of table.relations) {
    keys.add(rel.joinKey);
  }
  // Keys from other tables' relations that target this table
  for (const t of allTables) {
    for (const rel of t.relations) {
      if (rel.targetTable === table.id) {
        keys.add(rel.joinKey);
      }
    }
  }
  return Array.from(keys);
}

export default function ERDiagram({ tables, selectedTable, onSelectTable }: ERDiagramProps) {
  const tableMap = Object.fromEntries(tables.map((t) => [t.id, t]));

  // Zoom / pan state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((t) => ({
      ...t,
      scale: Math.min(3, Math.max(0.3, t.scale * delta)),
    }));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only pan on background (not on nodes)
    if ((e.target as Element).closest(".er-node")) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    setTransform((t) => ({
      ...t,
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const connections: Array<{ from: SemanticTable; to: SemanticTable; label: string }> = [];
  for (const table of tables) {
    for (const rel of table.relations) {
      const target = tableMap[rel.targetTable];
      if (target) connections.push({ from: table, to: target, label: rel.label });
    }
  }

  const NODE_W = 190;
  const NODE_H = 86;

  // Use dynamic positions from table.position, with fallbacks
  const getPos = (table: SemanticTable) => table.position ?? { x: 60, y: 60 };

  // Compute SVG viewBox based on table positions
  const allX = tables.map((t) => getPos(t).x);
  const allY = tables.map((t) => getPos(t).y);
  const minX = Math.min(...allX) - 20;
  const minY = Math.min(...allY) - 20;
  const maxX = Math.max(...allX) + NODE_W + 20;
  const maxY = Math.max(...allY) + NODE_H + 20;
  const vbWidth = Math.max(maxX - minX, 400);
  const vbHeight = Math.max(maxY - minY, 300);

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg"
      style={{ height: 360, cursor: isPanning.current ? "grabbing" : "grab", userSelect: "none" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${minX} ${minY} ${vbWidth} ${vbHeight}`}
        onWheel={handleWheel}
        style={{ display: "block" }}
      >
        <g transform={`translate(${transform.x / 2}, ${transform.y / 2}) scale(${transform.scale})`}>
          {/* Arrows */}
          {connections.map((conn, i) => {
            const from = getPos(conn.from);
            const to = getPos(conn.to);
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            return (
              <g key={i}>
                <path
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="#C4BFB6"
                  strokeWidth={1.5}
                />
                <polygon
                  points={`${x2},${y2} ${x2 - 7},${y2 - 4} ${x2 - 7},${y2 + 4}`}
                  fill="#C4BFB6"
                />
                <text
                  x={mx}
                  y={(y1 + y2) / 2 - 7}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={500}
                  fill="#6B6B6B"
                  className="select-none"
                  style={{ pointerEvents: "none" }}
                >
                  {conn.label}
                </text>
              </g>
            );
          })}

          {/* Table nodes */}
          {tables.map((table) => {
            const pos = getPos(table);
            const isSelected = selectedTable === table.id;
            const headerColor = TABLE_HEADER_COLORS[table.id] ?? "#2891DA";
            const joinKeys = getJoinKeyColumns(table, tables);
            // Show only join key columns (or first 2 columns if no join keys)
            const colsToShow = joinKeys.length > 0
              ? table.columns.filter((c) => joinKeys.includes(c.name)).slice(0, 3)
              : table.columns.slice(0, 2);

            return (
              <g
                key={table.id}
                className="cursor-pointer er-node"
                onClick={() => onSelectTable(table.id)}
              >
                {/* Card shadow */}
                <rect
                  x={pos.x + 2}
                  y={pos.y + 2}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="rgba(0,0,0,0.04)"
                />
                {/* Card body */}
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="#ffffff"
                  stroke={isSelected ? headerColor : "#D6D1C4"}
                  strokeWidth={isSelected ? 2 : 1}
                />
                {/* Header strip */}
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={NODE_W}
                  height={24}
                  rx={8}
                  fill={headerColor}
                  opacity={0.12}
                />
                <rect
                  x={pos.x}
                  y={pos.y + 16}
                  width={NODE_W}
                  height={8}
                  fill={headerColor}
                  opacity={0.12}
                />
                {/* Table name */}
                <text
                  x={pos.x + 10}
                  y={pos.y + 17}
                  fontSize={15}
                  fontWeight={700}
                  fill="#1C1A16"
                  className="select-none"
                  style={{ pointerEvents: "none" }}
                >
                  {table.name}
                </text>
                {/* Join key column previews */}
                {colsToShow.map((col, ci) => (
                  <text
                    key={ci}
                    x={pos.x + 10}
                    y={pos.y + 36 + ci * 17}
                    fontSize={12}
                    fill="#3D3D3D"
                    className="select-none"
                    style={{ pointerEvents: "none" }}
                  >
                    {col.name}
                    <tspan fill="#8C8278" fontSize={11}> ({col.type})</tspan>
                  </text>
                ))}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Zoom hint */}
      <div
        className="absolute bottom-2 right-2 text-xs px-2 py-1 rounded-lg pointer-events-none"
        style={{ background: "rgba(0,0,0,0.05)", color: "var(--text-muted)" }}
      >
        Scroll to zoom · drag to pan
      </div>
    </div>
  );
}
