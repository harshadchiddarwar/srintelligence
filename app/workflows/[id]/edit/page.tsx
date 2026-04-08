"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save, Play, Share2, Trash2, ArrowLeft } from "lucide-react";
import WorkflowCanvas from "@/components/workflows/WorkflowCanvas";

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
          {/* Schedule type */}
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

          {/* Day of week */}
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

          {/* Day of month */}
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

          {/* Time */}
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

export default function WorkflowEditPage() {
  const router = useRouter();
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const handleBack = () => {
    if (isDirty) {
      const confirmed = window.confirm("You have unsaved changes. Leave without saving?");
      if (!confirmed) return;
    }
    router.push("/workflows");
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "#ffffff" }}>
      {/* Settings bar */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 shrink-0"
        style={{ borderBottom: "1px solid var(--border)", background: "#ffffff" }}
      >
        {/* Back button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors hover:bg-black/5"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={13} />
          <span>Back</span>
        </button>

        <div style={{ width: 1, height: 28, background: "var(--border)" }} className="shrink-0" />

        <div className="flex flex-col justify-center mr-2">
          <input
            defaultValue="Payer Segmentation Pipeline"
            onChange={() => setIsDirty(true)}
            className="bg-transparent text-sm font-semibold outline-none border-b border-transparent focus:border-black/20 transition-colors pb-0.5 leading-tight"
            style={{ color: "var(--text-primary)", minWidth: 220 }}
          />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>v3</span>
        </div>

        <div style={{ width: 1, height: 28, background: "var(--border)" }} className="shrink-0" />

        <ToggleSwitch
          enabled={autoUpdate}
          onChange={setAutoUpdate}
          labelOff="Manual"
          labelOn="Auto-update"
        />

        {/* Schedule picker — only when auto-update */}
        {autoUpdate && <InlineSchedulePicker />}

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <Link
            href="/workflows/wf-2/run"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-90"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Play size={11} fill="white" />
            Run
          </Link>
          <button
            onClick={() => setIsDirty(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            <Save size={11} />
            Save
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/7"
            style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            <Share2 size={11} />
            Share
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/7"
            style={{ color: "var(--danger)", border: "1px solid var(--border)" }}
          >
            <Trash2 size={11} />
            Delete
          </button>
        </div>
      </div>

      {/* Canvas full width */}
      <div className="flex-1 overflow-hidden">
        <WorkflowCanvas />
      </div>
    </div>
  );
}
