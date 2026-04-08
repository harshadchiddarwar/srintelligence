"use client";

import { useState } from "react";
import { CheckCircle, ChevronDown, ChevronRight } from "lucide-react";
import { AgentActivity } from "@/lib/types";

export default function AgentActivityBar({ activity }: { activity: AgentActivity }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg overflow-hidden text-xs"
      style={{ border: "1px solid var(--border)", background: "var(--bg-tertiary)" }}
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-black/5"
        onClick={() => setExpanded(!expanded)}
      >
        <CheckCircle size={13} style={{ color: "var(--success)" }} />
        <span style={{ color: "var(--text-secondary)" }}>
          {activity.masterAgent} → Routed to{" "}
          <span style={{ color: "var(--accent)" }}>{activity.routedTo}</span>{" "}
          <span style={{ color: "var(--text-muted)" }}>({activity.latency})</span>
        </span>
        <span className="ml-auto" style={{ color: "var(--text-muted)" }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {expanded && (
        <div
          className="px-3 py-2 text-xs"
          style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}
        >
          <p>Semantic model: DataExplore</p>
          <p>SQL generated: ✅ 1 query executed</p>
          <p>Rows returned: 4 • Latency: {activity.latency}</p>
        </div>
      )}
    </div>
  );
}
