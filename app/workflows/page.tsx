"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Pin, LayoutGrid, Wrench, X } from "lucide-react";
import WorkflowCardComponent from "@/components/workflows/WorkflowCard";
import { workflows } from "@/lib/mock-data";

function TemplatePickerModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden"
        style={{ background: "#ffffff", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Choose a Template</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Start from an existing workflow</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-black/5 transition-colors" style={{ color: "var(--text-muted)" }}>
            <X size={15} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-2">
          {workflows.map((wf) => (
            <Link
              key={wf.id}
              href={`/workflows/${wf.id}/edit`}
              onClick={onClose}
              className="flex items-start gap-3 p-3 rounded-xl transition-colors hover:bg-black/4"
              style={{ border: "1px solid var(--border)" }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{wf.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{wf.description}</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {wf.agentChain.map((s) => s.label).join(" → ")}
                </p>
              </div>
              <span
                className="text-xs px-2 py-0.5 rounded-full shrink-0 mt-0.5"
                style={{ background: "rgba(40,145,218,0.08)", color: "var(--accent)", border: "1px solid rgba(40,145,218,0.2)" }}
              >
                Use template
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  const [showTemplate, setShowTemplate] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: "var(--bg-primary)" }}>
      <div className="px-5 py-5 w-full flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>My Workflows</h2>
          <Link
            href="/workflows/new/edit"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
            style={{ background: "#2891DA", color: "white" }}
          >
            <Plus size={15} />
            New Workflow
          </Link>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {workflows.map((wf) => (
            <WorkflowCardComponent key={wf.id} workflow={wf} />
          ))}

          {/* New Workflow card */}
          <div
            className="rounded-xl p-4 flex flex-col gap-3"
            style={{ background: "transparent", border: "1.5px dashed var(--border)" }}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <Plus size={16} style={{ color: "var(--text-muted)" }} />
              <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>New Workflow</span>
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Start from:</p>
            <div className="flex flex-col gap-2">
              <Link
                href="/chat"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors hover:bg-black/5"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                <Pin size={12} />
                Pin current chat conversation
              </Link>
              <Link
                href="/workflows/new/edit"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors hover:bg-black/5"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                <LayoutGrid size={12} />
                Build from scratch (visual canvas)
              </Link>
              <button
                onClick={() => setShowTemplate(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors hover:bg-black/5 text-left"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                <Wrench size={12} />
                Use a template
              </button>
            </div>
          </div>
        </div>
      </div>

      {showTemplate && <TemplatePickerModal onClose={() => setShowTemplate(false)} />}
    </div>
  );
}
