"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { ArrowUp, ChevronDown, Database } from "lucide-react";

interface SemanticView {
  id: string;
  displayName: string;
  description: string;
  fullyQualifiedName: string;
  isDefault?: boolean;
}

interface ChatInputProps {
  placeholder?: string;
  onSubmit: (value: string) => void;
  autoFocus?: boolean;
  compact?: boolean;
  disabled?: boolean;
}

export default function ChatInput({
  placeholder = "Ask a question...",
  onSubmit,
  autoFocus = false,
  compact = false,
  disabled = false,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [views, setViews] = useState<SemanticView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string>("");
  const [showPicker, setShowPicker] = useState(false);
  const [slashPopup, setSlashPopup] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch real semantic views from Snowflake on mount
  useEffect(() => {
    fetch("/api/semantic-views")
      .then((r) => r.json())
      .then((data: { views?: SemanticView[] }) => {
        const fetched = data.views ?? [];
        if (fetched.length > 0) {
          setViews(fetched);
          const def = fetched.find((v) => v.isDefault) ?? fetched[0];
          setSelectedViewId(def.id);
        }
      })
      .catch(() => {
        // Fallback to the known real view if API fails
        const fallback: SemanticView = {
          id: "cortex_testcase",
          displayName: "Analytics",
          description: "Rx claims, drug reference, physicians & plan data",
          fullyQualifiedName: "CORTEX_TESTING.PUBLIC.CORTEX_TESTCASE",
          isDefault: true,
        };
        setViews([fallback]);
        setSelectedViewId(fallback.id);
      });
  }, []);

  useEffect(() => {
    if (autoFocus && textareaRef.current) textareaRef.current.focus();
  }, [autoFocus]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Close picker when clicking outside
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  const handleChange = (newVal: string) => {
    setValue(newVal);
    if (newVal.endsWith("//")) {
      setSlashPopup(true);
      setSlashIdx(0);
    } else if (slashPopup) {
      setSlashPopup(false);
    }
  };

  const selectView = (id: string, name: string) => {
    setValue((v) => v.slice(0, v.lastIndexOf("//")) + `@${name} `);
    setSelectedViewId(id);
    setSlashPopup(false);
    textareaRef.current?.focus();
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashPopup) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, views.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const v = views[slashIdx];
        if (v) selectView(v.id, v.displayName);
        return;
      }
      if (e.key === "Escape") { setSlashPopup(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const selectedView = views.find((v) => v.id === selectedViewId);

  return (
    <div ref={containerRef} className="flex flex-col gap-2 relative">
      {/* "//" popup */}
      {slashPopup && views.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-1 z-50 rounded-xl shadow-xl overflow-hidden"
          style={{ background: "#ffffff", border: "1px solid var(--border)", minWidth: 220 }}
        >
          <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>Pick a semantic model</p>
            <p style={{ color: "var(--text-muted)", fontSize: "10px" }}>Tab or Enter to select · Esc to dismiss</p>
          </div>
          {views.map((v, i) => (
            <button
              key={v.id}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
              style={{
                background: i === slashIdx ? "var(--accent-dim)" : "transparent",
                borderBottom: i < views.length - 1 ? "1px solid var(--border)" : "none",
              }}
              onMouseEnter={() => setSlashIdx(i)}
              onClick={() => selectView(v.id, v.displayName)}
            >
              <Database size={13} style={{ color: "#2891DA", flexShrink: 0 }} />
              <div>
                <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{v.displayName}</p>
                <p style={{ color: "var(--text-muted)", fontSize: "10px" }}>{v.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      <div
        className="flex items-end gap-3 rounded-xl px-4 py-3"
        style={{ background: "#ffffff", border: "1px solid var(--border)" }}
      >
        {/* Semantic view selector */}
        {views.length > 0 && (
          <div className="relative shrink-0">
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors hover:bg-black/5"
              style={{ border: "1px solid var(--border)", color: "var(--text-muted)", background: "var(--bg-secondary)", maxWidth: 120 }}
              title="Select semantic model"
            >
              <Database size={11} style={{ flexShrink: 0 }} />
              <span className="truncate" style={{ maxWidth: 80 }}>
                {selectedView?.displayName ?? "Analytics"}
              </span>
              <ChevronDown size={10} style={{ flexShrink: 0 }} />
            </button>

            {showPicker && (
              <div
                className="absolute bottom-full left-0 mb-1 z-40 rounded-xl shadow-xl overflow-hidden"
                style={{ background: "#ffffff", border: "1px solid var(--border)", minWidth: 210 }}
              >
                {views.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => { setSelectedViewId(v.id); setShowPicker(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-black/5"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <Database size={12} style={{ color: "#2891DA", flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{v.displayName}</p>
                      <p className="truncate" style={{ color: "var(--text-muted)", fontSize: "10px" }}>{v.description}</p>
                    </div>
                    {selectedViewId === v.id && (
                      <span className="ml-auto text-xs shrink-0" style={{ color: "#2891DA" }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
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
          disabled={!value.trim() || disabled}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-all shrink-0"
          style={{
            background: value.trim() && !disabled ? "#2891DA" : "var(--bg-hover)",
            color:      value.trim() && !disabled ? "white"   : "var(--text-muted)",
            cursor:     value.trim() && !disabled ? "pointer" : "not-allowed",
          }}
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
