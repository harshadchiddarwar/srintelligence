"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { ArrowUp, ChevronDown, Database, AlertTriangle } from "lucide-react";
import { semanticModels } from "@/lib/mock-data";

interface ChatInputProps {
  placeholder?: string;
  onSubmit: (value: string) => void;
  autoFocus?: boolean;
  compact?: boolean;
}

export default function ChatInput({
  placeholder = "Ask a question...",
  onSubmit,
  autoFocus = false,
  compact = false,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | "multiple">(semanticModels[0].id);
  const [showModelPicker, setShowModelPicker] = useState(false);
  // "//" popup state
  const [slashPopup, setSlashPopup] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Auto-resize textarea height based on content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Detect "//" in textarea to trigger model picker popup
  const handleChange = (newVal: string) => {
    setValue(newVal);
    // Check if the user just typed "//"
    if (newVal.endsWith("//")) {
      setSlashPopup(true);
      setSlashIdx(0);
    } else if (slashPopup) {
      setSlashPopup(false);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashPopup) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(i + 1, semanticModels.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const model = semanticModels[slashIdx];
        // Replace "//" with model name mention
        setValue((v) => v.slice(0, v.lastIndexOf("//")) + `@${model.name} `);
        setSelectedModelId(model.id);
        setSlashPopup(false);
        return;
      }
      if (e.key === "Escape") {
        setSlashPopup(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const selectedModel = selectedModelId === "multiple"
    ? null
    : semanticModels.find((m) => m.id === selectedModelId);

  const isMultiple = selectedModelId === "multiple";

  return (
    <div ref={containerRef} className="flex flex-col gap-2 relative">
      {/* Multi-model hint */}
      {isMultiple && (
        <div
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs"
          style={{ background: "rgba(40,145,218,0.06)", border: "1px solid rgba(40,145,218,0.15)", color: "#2891DA" }}
        >
          <AlertTriangle size={12} />
          <span>Multiple models selected — results will join across semantic models. Type <code className="font-mono font-bold">//</code> to reference a specific model in your query.</span>
        </div>
      )}

      {/* "//" popup */}
      {slashPopup && (
        <div
          className="absolute bottom-full left-0 mb-1 z-50 rounded-xl shadow-xl overflow-hidden"
          style={{ background: "#ffffff", border: "1px solid var(--border)", minWidth: 220 }}
        >
          <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>Pick a semantic model</p>
            <p className="text-xs" style={{ color: "var(--text-muted)", fontSize: "10px" }}>Tab or Enter to select · Esc to dismiss</p>
          </div>
          {semanticModels.map((m, i) => (
            <button
              key={m.id}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
              style={{
                background: i === slashIdx ? "var(--accent-dim)" : "transparent",
                borderBottom: i < semanticModels.length - 1 ? "1px solid var(--border)" : "none",
              }}
              onMouseEnter={() => setSlashIdx(i)}
              onClick={() => {
                setValue((v) => v.slice(0, v.lastIndexOf("//")) + `@${m.name} `);
                setSelectedModelId(m.id);
                setSlashPopup(false);
                textareaRef.current?.focus();
              }}
            >
              <Database size={13} style={{ color: "#2891DA", flexShrink: 0 }} />
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{m.name}</p>
                <p className="text-xs" style={{ color: "var(--text-muted)", fontSize: "10px" }}>{m.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      <div
        className="flex items-end gap-3 rounded-xl px-4 py-3"
        style={{
          background: "#ffffff",
          border: "1px solid var(--border)",
        }}
      >
        {/* Semantic model selector */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowModelPicker((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors hover:bg-black/5"
            style={{
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              background: "var(--bg-secondary)",
              maxWidth: 110,
            }}
            title="Select semantic model"
          >
            <Database size={11} style={{ flexShrink: 0 }} />
            <span className="truncate" style={{ maxWidth: 70 }}>
              {isMultiple ? "Multiple" : (selectedModel?.name ?? "Model")}
            </span>
            <ChevronDown size={10} style={{ flexShrink: 0 }} />
          </button>

          {showModelPicker && (
            <div
              className="absolute bottom-full left-0 mb-1 z-40 rounded-xl shadow-xl overflow-hidden"
              style={{ background: "#ffffff", border: "1px solid var(--border)", minWidth: 200 }}
            >
              {semanticModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setSelectedModelId(m.id); setShowModelPicker(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-black/5"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <Database size={12} style={{ color: "#2891DA", flexShrink: 0 }} />
                  <div>
                    <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{m.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)", fontSize: "10px" }}>{m.description}</p>
                  </div>
                  {selectedModelId === m.id && (
                    <span className="ml-auto text-xs" style={{ color: "#2891DA" }}>✓</span>
                  )}
                </button>
              ))}
              <button
                onClick={() => { setSelectedModelId("multiple"); setShowModelPicker(false); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-black/5"
              >
                <Database size={12} style={{ color: "#a78bfa", flexShrink: 0 }} />
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>Multiple models</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)", fontSize: "10px" }}>Join across semantic models</p>
                </div>
                {isMultiple && (
                  <span className="ml-auto text-xs" style={{ color: "#a78bfa" }}>✓</span>
                )}
              </button>
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={isMultiple ? 'Ask across all models… type "//" to reference a specific model' : placeholder}
          rows={1}
          className="flex-1 resize-none outline-none text-sm leading-relaxed bg-transparent"
          style={{
            color: "var(--text-primary)",
            maxHeight: compact ? "120px" : "200px",
            overflowY: "auto",
            lineHeight: "1.5",
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim()}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-all shrink-0"
          style={{
            background: value.trim() ? "#2891DA" : "var(--bg-hover)",
            color: value.trim() ? "white" : "var(--text-muted)",
            cursor: value.trim() ? "pointer" : "not-allowed",
          }}
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
