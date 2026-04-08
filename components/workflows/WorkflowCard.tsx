"use client";

import { useState } from "react";
import Link from "next/link";
import { Play, Edit2, Share2, Calendar, RefreshCw, BarChart3, Layers, TrendingUp, Activity, Cpu, GitFork, FileText, Zap, Copy, Check } from "lucide-react";
import { LucideIcon } from "lucide-react";
import { WorkflowCard as WorkflowCardType } from "@/lib/types";

const AGENT_ICONS: Record<string, LucideIcon> = {
  "cortex-analyst": BarChart3,
  clustering: Layers,
  prophet: TrendingUp,
  sarima: Activity,
  xgboost: Cpu,
  mtree: GitFork,
  output: FileText,
};

const AGENT_COLORS: Record<string, string> = {
  "cortex-analyst": "#4f8ef7",
  clustering: "#a78bfa",
  prophet: "#34c98b",
  sarima: "#34c98b",
  xgboost: "#f5a623",
  mtree: "#fb923c",
  output: "#64748b",
};

function ChainBadge({ chain }: { chain: WorkflowCardType["agentChain"] }) {
  return (
    <div className="flex items-center gap-1.5">
      {chain.map((step, i) => {
        const Icon = AGENT_ICONS[step.type] ?? BarChart3;
        return (
          <span key={step.id} className="flex items-center gap-1.5">
            <span
              className="flex items-center justify-center w-6 h-6 rounded"
              style={{ background: "var(--bg-tertiary)" }}
              title={step.label}
            >
              <Icon size={13} style={{ color: "#111111" }} strokeWidth={1.5} />
            </span>
            {i < chain.length - 1 && (
              <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>→</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

interface WorkflowCardProps {
  workflow: WorkflowCardType;
  onDuplicate?: (id: string) => void;
}

export default function WorkflowCardComponent({ workflow, onDuplicate }: WorkflowCardProps) {
  const [saved, setSaved] = useState(false);
  const [shared, setShared] = useState(false);
  const [duplicated, setDuplicated] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleShare = () => {
    const url = `${window.location.origin}/workflows/${workflow.id}/edit`;
    navigator.clipboard.writeText(url).then(() => {
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    });
  };

  const handleDuplicate = () => {
    onDuplicate?.(workflow.id);
    setDuplicated(true);
    setTimeout(() => setDuplicated(false), 1500);
  };

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3 transition-all hover:shadow-sm"
      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Zap size={13} style={{ color: "var(--accent)" }} strokeWidth={1.5} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {workflow.name}
            </h3>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {workflow.description}
          </p>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full shrink-0"
          style={{ background: "rgba(5,150,105,0.08)", color: "var(--success)", border: "1px solid rgba(5,150,105,0.2)" }}
        >
          Success
        </span>
      </div>

      {/* Agent chain */}
      <ChainBadge chain={workflow.agentChain} />

      {/* Meta */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {workflow.schedule === "auto" ? (
            <><RefreshCw size={11} />Auto — {workflow.scheduleLabel}</>
          ) : (
            <><Calendar size={11} />Manual-Update</>
          )}
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Last run: {workflow.lastRun} · #{workflow.runCount} runs
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 flex-wrap" style={{ borderTop: "1px solid var(--border)" }}>
        <Link
          href={`/workflows/${workflow.id}/run`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-90"
          style={{ background: "#2891DA", color: "white" }}
        >
          <Play size={11} fill="white" />
          Run Now
        </Link>
        <Link
          href={`/workflows/${workflow.id}/edit`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
          style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        >
          <Edit2 size={11} />
          Edit
        </Link>
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
          style={{ color: saved ? "var(--success)" : "var(--text-muted)", border: `1px solid ${saved ? "rgba(5,150,105,0.3)" : "var(--border)"}` }}
        >
          {saved ? <Check size={11} /> : null}
          {saved ? "Saved!" : "Save"}
        </button>
        <button
          onClick={handleDuplicate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
          style={{ color: duplicated ? "var(--accent)" : "var(--text-muted)" }}
        >
          <Copy size={11} />
          {duplicated ? "Duplicated!" : "Duplicate"}
        </button>
        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5 ml-auto"
          style={{ color: shared ? "var(--success)" : "var(--text-muted)" }}
          title="Copy link to clipboard"
        >
          {shared ? <Check size={11} /> : <Share2 size={11} />}
          {shared ? "Copied!" : "Share"}
        </button>
      </div>
    </div>
  );
}
