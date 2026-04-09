"use client";

import { useEffect, useState } from "react";
import { GitBranch, Clock, Database, ChevronRight } from "lucide-react";

interface LineageStep {
  id: string;
  agentName: string;
  intent: string;
  sql?: string;
  timestamp: number;
  durationMs?: number;
}

interface LineageGraphProps {
  lineageId?: string;
  sessionId?: string;
  /** Pre-fetched chain data — skips API call when provided */
  chain?: unknown[];
  compact?: boolean;
}

export default function LineageGraph({ lineageId, sessionId, chain: chainProp, compact = false }: LineageGraphProps) {
  const [steps, setSteps] = useState<LineageStep[]>(() =>
    Array.isArray(chainProp) ? (chainProp as LineageStep[]) : []
  );
  const [loading, setLoading] = useState(!chainProp);

  useEffect(() => {
    if (chainProp) return; // already have data
    if (!lineageId && !sessionId) { setLoading(false); return; }
    const url = sessionId
      ? `/api/lineage/session/${sessionId}`
      : `/api/lineage/${lineageId}/chain`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => { setSteps(Array.isArray(data.chain) ? data.chain : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [lineageId, sessionId, chainProp]);

  if (loading) return <div className="text-xs" style={{ color: "var(--text-muted)" }}>Loading lineage…</div>;
  if (!steps.length) return <div className="text-xs" style={{ color: "var(--text-muted)" }}>No lineage recorded.</div>;

  if (compact) {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {steps.map((step, i) => (
          <span key={step.id} className="flex items-center gap-1">
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
              {step.agentName}
            </span>
            {i < steps.length - 1 && <ChevronRight size={10} style={{ color: "var(--text-muted)" }} />}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 mb-1">
        <GitBranch size={13} style={{ color: "var(--accent)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Data Lineage</span>
      </div>
      <div className="flex flex-col gap-3">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: "var(--accent)", color: "white", fontSize: "10px" }}>
              {i + 1}
            </div>
            <div className="flex-1 rounded-lg p-3" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{step.agentName}</span>
                <div className="flex items-center gap-2">
                  {step.durationMs != null && (
                    <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                      <Clock size={9} />{(step.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(40,145,218,0.1)", color: "#2891DA", fontSize: "9px" }}>{step.intent}</span>
                </div>
              </div>
              {step.sql && (
                <pre className="text-xs mt-1.5 p-2 rounded overflow-x-auto" style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)", fontFamily: "monospace", fontSize: "10px", maxHeight: 80 }}>
                  {step.sql.trim().slice(0, 200)}{step.sql.length > 200 ? "…" : ""}
                </pre>
              )}
              <span className="flex items-center gap-1 text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                <Database size={9} />{step.id.slice(0, 8)}… · {new Date(step.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
