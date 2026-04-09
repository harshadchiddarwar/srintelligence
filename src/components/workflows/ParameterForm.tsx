"use client";

import { useState } from "react";
import type { WorkflowParameter } from "@/src/types/workflow";

interface ParameterFormProps {
  parameters: WorkflowParameter[];
  onSubmit: (values: Record<string, string | number | boolean | string[]>) => void;
  loading?: boolean;
  submitLabel?: string;
}

export default function ParameterForm({ parameters, onSubmit, loading = false, submitLabel = "Run" }: ParameterFormProps) {
  const [values, setValues] = useState<Record<string, string | number | boolean | string[]>>(() => {
    const init: Record<string, string | number | boolean | string[]> = {};
    for (const p of parameters) {
      if (p.defaultValue !== undefined) init[p.key] = p.defaultValue;
    }
    return init;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    for (const p of parameters) {
      if (p.required && (values[p.key] === undefined || values[p.key] === "")) {
        newErrors[p.key] = `${p.label} is required`;
      }
      if (p.type === "string" && p.validationPattern && typeof values[p.key] === "string") {
        const re = new RegExp(p.validationPattern);
        if (!re.test(values[p.key] as string)) {
          newErrors[p.key] = `Invalid format`;
        }
      }
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length === 0) {
      onSubmit(values);
    }
  };

  const set = (key: string, value: string | number | boolean | string[]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => { const e = { ...prev }; delete e[key]; return e; });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {parameters.map((param) => (
        <div key={param.key}>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>
            {param.label}
            {param.required && <span style={{ color: "#ef4444" }}> *</span>}
          </label>

          {param.description && (
            <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{param.description}</p>
          )}

          {param.type === "string" && (
            <input
              type="text"
              value={(values[param.key] as string) ?? ""}
              onChange={(e) => set(param.key, e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: "var(--bg-tertiary)", border: `1px solid ${errors[param.key] ? "#ef4444" : "var(--border)"}`, color: "var(--text-primary)" }}
            />
          )}

          {param.type === "number" && (
            <input
              type="number"
              value={(values[param.key] as number) ?? ""}
              onChange={(e) => set(param.key, Number(e.target.value))}
              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: "var(--bg-tertiary)", border: `1px solid ${errors[param.key] ? "#ef4444" : "var(--border)"}`, color: "var(--text-primary)" }}
            />
          )}

          {param.type === "boolean" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(values[param.key])}
                onChange={(e) => set(param.key, e.target.checked)}
                className="rounded"
              />
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Enabled</span>
            </label>
          )}

          {param.type === "date" && (
            <input
              type="date"
              value={(values[param.key] as string) ?? ""}
              onChange={(e) => set(param.key, e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: "var(--bg-tertiary)", border: `1px solid ${errors[param.key] ? "#ef4444" : "var(--border)"}`, color: "var(--text-primary)" }}
            />
          )}

          {(param.type === "select" || param.type === "multiselect") && param.options && (
            <select
              multiple={param.type === "multiselect"}
              value={
                param.type === "multiselect"
                  ? ((values[param.key] as string[]) ?? [])
                  : (values[param.key] as string) ?? ""
              }
              onChange={(e) => {
                if (param.type === "multiselect") {
                  const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                  set(param.key, selected);
                } else {
                  set(param.key, e.target.value);
                }
              }}
              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: "var(--bg-tertiary)", border: `1px solid ${errors[param.key] ? "#ef4444" : "var(--border)"}`, color: "var(--text-primary)" }}
            >
              {!param.required && param.type === "select" && <option value="">— select —</option>}
              {param.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}

          {errors[param.key] && (
            <p className="text-xs mt-1" style={{ color: "#ef4444" }}>{errors[param.key]}</p>
          )}
        </div>
      ))}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 rounded-lg text-xs font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
        style={{ background: "var(--accent)", color: "white" }}
      >
        {loading ? "Running…" : submitLabel}
      </button>
    </form>
  );
}
