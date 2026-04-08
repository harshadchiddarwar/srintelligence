"use client";

import { useState, useEffect } from "react";
import { CheckCircle, Clock, Loader, Circle } from "lucide-react";
import { workflowRun } from "@/lib/mock-data";
import { WorkflowRunStep } from "@/lib/types";
import ChatInput from "@/components/chat/ChatInput";

function StepStatusIcon({ status }: { status: WorkflowRunStep["status"] }) {
  if (status === "done")
    return <CheckCircle size={14} className="shrink-0" style={{ color: "var(--success)" }} />;
  if (status === "running")
    return <Loader size={14} className="animate-spin" style={{ color: "var(--accent)" }} />;
  if (status === "failed")
    return <Circle size={14} style={{ color: "var(--danger)" }} />;
  return <Circle size={14} style={{ color: "var(--text-muted)", opacity: 0.4 }} />;
}

function ProgressBar({ progress, status }: { progress: number; status: WorkflowRunStep["status"] }) {
  const color =
    status === "done"
      ? "var(--success)"
      : status === "running"
      ? "var(--accent)"
      : "var(--bg-hover)";

  return (
    <div
      className="flex-1 rounded-full h-1.5 overflow-hidden"
      style={{ background: "var(--bg-hover)" }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${progress}%`, background: color }}
      />
    </div>
  );
}

function ClusterResults({ segments }: { segments: Array<{ name: string; plans: string[]; characteristics: string; confidence: string }> }) {
  return (
    <div className="flex flex-col gap-3">
      {segments.map((seg, i) => (
        <div
          key={i}
          className="rounded-lg p-3"
          style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}
        >
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
            Segment {String.fromCharCode(65 + i)}: "{seg.name}" ({seg.plans.length} plans)
          </p>
          <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
            {seg.plans.join(", ")}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Characteristics: {seg.characteristics}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Model Confidence: High ({seg.confidence})
          </p>
        </div>
      ))}
    </div>
  );
}

export default function WorkflowRunPage() {
  const [steps, setSteps] = useState(workflowRun.steps);
  const [progress3a, setProgress3a] = useState(68);

  // Simulate step 3a completing and 3b starting
  useEffect(() => {
    const tick = setInterval(() => {
      setProgress3a((p) => {
        if (p >= 100) {
          clearInterval(tick);
          setSteps((prev) =>
            prev.map((s) => {
              if (s.stepId === "s3a") return { ...s, status: "done", duration: "5.1s", progress: 100 };
              if (s.stepId === "s3b") return { ...s, status: "running", progress: 20 };
              return s;
            })
          );
          return 100;
        }
        return p + 2;
      });
    }, 150);
    return () => clearInterval(tick);
  }, []);

  return (
    <div
      className="flex flex-col h-full overflow-y-auto"
      style={{ background: "var(--bg-primary)" }}
    >
      <div className="px-6 py-5 max-w-3xl w-full mx-auto flex flex-col gap-5">
        {/* Execution status */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border)" }}
        >
          <div
            className="flex items-center gap-3 px-4 py-3"
            style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" }}
          >
            <Clock size={13} style={{ color: "var(--text-muted)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Execution Status — Run #{workflowRun.runNumber} — {workflowRun.startedAt}
            </span>
          </div>
          <div className="p-4 flex flex-col gap-2.5">
            {steps.map((step) => (
              <div key={step.stepId} className="flex items-center gap-3">
                <StepStatusIcon status={step.status} />
                <span className="text-xs w-40 shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {step.icon} {step.label}
                </span>
                <ProgressBar
                  progress={step.stepId === "s3a" ? progress3a : step.progress ?? 0}
                  status={step.status}
                />
                <span className="text-xs shrink-0 w-24 text-right" style={{ color: "var(--text-muted)" }}>
                  {step.status === "done"
                    ? `✅ Done (${step.duration})`
                    : step.status === "running"
                    ? "⏳ Running..."
                    : "⬚ Pending"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Step results */}
        {steps
          .filter((s) => s.status === "done" || s.status === "running")
          .map((step) => {
            const resultData = step.result?.data as Record<string, unknown> | undefined;
            return (
              <div
                key={step.stepId}
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--border)" }}
              >
                <div
                  className="flex items-center gap-2 px-4 py-2.5"
                  style={{
                    background: "var(--bg-secondary)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {step.icon} {step.label}
                  </span>
                  <span
                    className="ml-auto text-xs"
                    style={{
                      color: step.status === "done" ? "var(--success)" : "var(--accent)",
                    }}
                  >
                    {step.status === "done" ? `✅ Done (${step.duration})` : "⏳ Running..."}
                  </span>
                </div>

                <div className="p-4">
                  {step.status === "running" && (
                    <div className="flex items-center gap-2">
                      <ProgressBar progress={progress3a} status="running" />
                      <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
                        {progress3a}% complete...
                      </span>
                    </div>
                  )}

                  {step.result?.type === "table" && resultData && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border)" }}>
                            {(resultData.headers as string[]).map((h: string) => (
                              <th
                                key={h}
                                className="px-3 py-2 text-left font-medium"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(resultData.rows as string[][]).map((row, ri) => (
                            <tr
                              key={ri}
                              style={{
                                borderBottom:
                                  ri < (resultData.rows as string[][]).length - 1
                                    ? "1px solid var(--border)"
                                    : "none",
                              }}
                            >
                              {row.map((cell, ci) => (
                                <td
                                  key={ci}
                                  className="px-3 py-2"
                                  style={{ color: "var(--text-primary)" }}
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {step.result?.type === "segments" && resultData && (
                    <ClusterResults
                      segments={
                        (resultData.segments as Array<{
                          name: string;
                          plans: string[];
                          characteristics: string;
                          confidence: string;
                        }>)
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}

        {/* Inline chat */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border)" }}
        >
          <div
            className="px-4 py-2.5 text-sm font-medium"
            style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            💬 Ask about this run
          </div>
          <div className="p-4">
            <ChatInput
              placeholder="Why was Humana classified as at-risk?"
              onSubmit={() => {}}
              compact
            />
          </div>
        </div>

        <div className="h-4" />
      </div>
    </div>
  );
}
