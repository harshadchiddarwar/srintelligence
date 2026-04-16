"use client";

import React, { useState, useRef, useEffect, KeyboardEvent } from "react";
import { ArrowUp, ChevronDown, ChevronRight, Database, StopCircle, Star, TrendingUp, Layers, GitFork, BarChart2, GitPullRequestArrow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Agent + model catalogue shown in the "/" picker
// ---------------------------------------------------------------------------

interface AgentModel {
  id: string;
  label: string;
  description: string;
  /** Tag inserted into the textarea */
  tag: string;
  /** Optional prompt template inserted after the tag (placeholders wrapped in []) */
  template?: string;
}

interface AgentOption {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Icon stroke color */
  color: string;
  description: string;
  /** Tag inserted when no model is chosen (or agent has no models) */
  tag: string;
  models?: AgentModel[];
}

const AGENT_OPTIONS: AgentOption[] = [
  {
    id: "analyst",
    label: "Analytics",
    icon: BarChart2,
    color: "#2891DA",
    description: "Natural language → SQL via SRI Analytics Engine",
    tag: "@Analytics",
  },
  {
    id: "forecast",
    label: "Forecast",
    icon: TrendingUp,
    color: "#34c98b",
    description: "Time-series demand forecasting",
    tag: "@Forecast",
    models: [
      {
        id: "auto",         label: "Auto (best-fit)",  description: "Let SRI pick the optimal model",    tag: "@Forecast",
        template: "Forecast [metric / what to predict] at [weekly|monthly] granularity using [N weeks|N months] of history for [N periods] ahead",
      },
      {
        id: "prophet",      label: "Prophet",           description: "Trend + seasonality decomposition", tag: "@Forecast/Prophet",
        template: "Forecast [metric / what to predict] using Prophet at [weekly|monthly] granularity using [N weeks|N months] of history for [N periods] ahead",
      },
      {
        id: "sarima",       label: "SARIMA",            description: "Statistical time-series model",     tag: "@Forecast/SARIMA",
        template: "Forecast [metric / what to predict] using SARIMA at [weekly|monthly] granularity using [N weeks|N months] of history for [N periods] ahead",
      },
      {
        id: "holt-winters", label: "Holt-Winters",      description: "Exponential smoothing",             tag: "@Forecast/Holt-Winters",
        template: "Forecast [metric / what to predict] using Holt-Winters at [weekly|monthly] granularity using [N weeks|N months] of history for [N periods] ahead",
      },
      {
        id: "xgboost",      label: "XGBoost",           description: "Gradient boosted trees",            tag: "@Forecast/XGBoost",
        template: "Forecast [metric / what to predict] using XGBoost at [weekly|monthly] granularity using [N weeks|N months] of history for [N periods] ahead using features: [feature1, feature2, ...]",
      },
    ],
  },
  {
    id: "clustering",
    label: "Clustering",
    icon: Layers,
    color: "#a78bfa",
    description: "Unsupervised patient & plan segmentation",
    tag: "@Clustering",
    models: [
      {
        id: "auto", label: "Auto (best-fit)", description: "Let SRI pick the optimal algorithm",
        tag: "@Clustering",
        template: "Segment [describe your population, e.g. physicians / patients / plans] into [N or 0 for auto-K] clusters using features: [feature1, feature2, ...]",
      },
      {
        id: "kmeans", label: "K-Means", description: "Classic centroid clustering",
        tag: "@Clustering/KMeans",
        template: "Segment [describe your population] into [N or 0 for auto-K] clusters using features: [feature1, feature2, ...]",
      },
      {
        id: "gmm", label: "GMM", description: "Gaussian Mixture Model (soft assign)",
        tag: "@Clustering/GMM",
        template: "Segment [describe your population] into [N or 0 for auto-K] clusters using GMM (Gaussian Mixture Model) with features: [feature1, feature2, ...]",
      },
      {
        id: "dbscan", label: "DBSCAN", description: "Density-based spatial clustering",
        tag: "@Clustering/DBSCAN",
        template: "Segment [describe your population] using density-based clustering on features: [feature1, feature2, ...] (number of clusters is determined automatically)",
      },
      {
        id: "hierarchical", label: "Hierarchical", description: "Agglomerative hierarchical clustering",
        tag: "@Clustering/Hierarchical",
        template: "Segment [describe your population] into [N or 0 for auto-K] hierarchical clusters using features: [feature1, feature2, ...]",
      },
      {
        id: "kmedoids", label: "K-Medoids", description: "Robust variant of K-Means",
        tag: "@Clustering/KMedoids",
        template: "Segment [describe your population] into [N or 0 for auto-K] clusters using K-Medoids on features: [feature1, feature2, ...]",
      },
    ],
  },
  {
    id: "mtree",
    label: "mTree™",
    icon: GitFork,
    color: "#fb923c",
    description: "Driver analysis & waterfall explainability",
    tag: "@mTree",
  },
  {
    id: "causal",
    label: "Causal Inference",
    icon: GitPullRequestArrow,
    color: "#8b5cf6",
    description: "4-phase causal discovery & DML",
    tag: "@Causal",
  },
];

// ---------------------------------------------------------------------------
// Semantic view type (for "//")
// ---------------------------------------------------------------------------

interface SemanticView {
  id: string;
  displayName: string;
  description: string;
  fullyQualifiedName: string;
  isDefault?: boolean;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ChatInputProps {
  placeholder?: string;
  onSubmit: (value: string) => void;
  onAbort?: () => void;
  history?: string[];
  autoFocus?: boolean;
  compact?: boolean;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find all [placeholder] spans in a string. Returns [{start, end, text}] */
function findPlaceholders(text: string) {
  const results: Array<{ start: number; end: number; text: string }> = [];
  const re = /\[[^\]]+\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    results.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return results;
}

/** Return true when a placeholder text looks like a feature list slot */
function isFeaturePlaceholder(text: string) {
  return /feature/i.test(text);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ChatInput({
  placeholder = "Ask a question...",
  onSubmit,
  onAbort,
  history = [],
  autoFocus = false,
  compact = false,
  disabled = false,
}: ChatInputProps) {
  const [value, setValue] = useState("");

  // Semantic views (for "//" picker)
  const [views, setViews] = useState<SemanticView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string>("");
  const [showPicker, setShowPicker] = useState(false);

  // "//" semantic model popup
  const [slashTwoPopup, setSlashTwoPopup] = useState(false);
  const [slashTwoIdx, setSlashTwoIdx] = useState(0);

  // "/" agent picker popup
  const [agentPopup, setAgentPopup] = useState(false);
  const [agentIdx, setAgentIdx] = useState(0);
  const [inModelMenu, setInModelMenu] = useState(false);
  const [modelIdx, setModelIdx] = useState(0);

  // Feature column picker
  const [viewColumns, setViewColumns] = useState<string[]>([]);
  const [tableColumns, setTableColumns] = useState<{ table: string; columns: string[] }[]>([]);
  const [featurePopup, setFeaturePopup] = useState(false);
  const [featureQuery, setFeatureQuery] = useState("");
  const [featureIdx, setFeatureIdx] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const featureListRef = useRef<HTMLDivElement>(null);

  // Prompt history cycling
  const historyIdxRef = useRef(-1);
  const draftRef = useRef("");

  // Fetch semantic views
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

  // Fetch columns when selected view changes
  useEffect(() => {
    if (!selectedViewId) return;
    fetch(`/api/semantic-views/${selectedViewId}/columns`)
      .then((r) => r.json())
      .then((data: { columns?: string[]; tableColumns?: { table: string; columns: string[] }[] }) => {
        setViewColumns(data.columns ?? []);
        setTableColumns(data.tableColumns ?? []);
      })
      .catch(() => { setViewColumns([]); setTableColumns([]); });
  }, [selectedViewId]);

  useEffect(() => {
    if (autoFocus && textareaRef.current) textareaRef.current.focus();
  }, [autoFocus]);

  // Auto-resize
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Close view picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setShowPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  // Scroll selected feature into view
  useEffect(() => {
    if (!featurePopup || !featureListRef.current) return;
    const item = featureListRef.current.querySelector(`[data-feature-idx="${featureIdx}"]`) as HTMLElement | null;
    item?.scrollIntoView({ block: "nearest" });
  }, [featureIdx, featurePopup]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const closeAllPopups = () => {
    setAgentPopup(false);
    setSlashTwoPopup(false);
    setInModelMenu(false);
    setFeaturePopup(false);
  };

  // Build a flat list of {col, table} items for the feature picker, filtered by featureQuery
  // Groups are preserved from tableColumns; fall back to flat viewColumns if tableColumns is empty.
  const filteredColumnItems: { col: string; table: string }[] = featureQuery
    ? viewColumns
        .filter((c) => c.toLowerCase().includes(featureQuery.toLowerCase()))
        .map((col) => {
          const grp = tableColumns.find((t) => t.columns.includes(col));
          return { col, table: grp?.table ?? '' };
        })
    : tableColumns.length > 0
      ? tableColumns.flatMap((t) => t.columns.map((col) => ({ col, table: t.table })))
      : viewColumns.map((col) => ({ col, table: '' }));

  // Legacy flat list (used by scroll-into-view logic)
  const filteredColumns = filteredColumnItems.map((x) => x.col);

  /** Insert a column name, replacing the currently selected [feature...] bracket */
  const insertColumn = (col: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value;
    const selStart = el.selectionStart;
    const selEnd = el.selectionEnd;

    // Replace the current bracket selection with the column name
    const newText = text.slice(0, selStart) + col + text.slice(selEnd);
    setValue(newText);
    setFeaturePopup(false);
    setFeatureQuery("");

    // Place cursor after the inserted column
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      const pos = selStart + col.length;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
    });
  };

  /** Cycle to the next [placeholder] via Tab */
  const cycleToNextPlaceholder = (e: { preventDefault: () => void }) => {
    const el = textareaRef.current;
    if (!el) return;
    const text = el.value;
    const placeholders = findPlaceholders(text);
    if (placeholders.length === 0) return; // no template — let Tab behave normally

    e.preventDefault();

    const cursorEnd = el.selectionEnd;
    const cursorStart = el.selectionStart;

    // If cursor is inside a placeholder, find the next one after it
    const insidePlaceholder = placeholders.find(
      (p) => p.start <= cursorStart && p.end >= cursorEnd
    );
    const searchFrom = insidePlaceholder ? insidePlaceholder.end : cursorEnd;
    const next =
      placeholders.find((p) => p.start >= searchFrom) ?? placeholders[0];

    el.setSelectionRange(next.start, next.end);

    // Show feature popup when landing on a feature placeholder
    if (isFeaturePlaceholder(next.text)) {
      setFeaturePopup(true);
      setFeatureQuery("");
      setFeatureIdx(0);
    } else {
      setFeaturePopup(false);
    }
  };

  const selectAgentModel = (aIdx: number, mIdx?: number) => {
    const agent = AGENT_OPTIONS[aIdx];
    const model = mIdx !== undefined ? agent.models?.[mIdx] : undefined;
    const tag = model ? model.tag : agent.tag;
    const template = model?.template ?? undefined;

    // Build the full text: replace everything from the last "/" up to cursor
    const newText = template
      ? `${tag} ${template}`
      : `${tag} `;

    setValue((v) => v.slice(0, v.lastIndexOf("/")) + newText);
    closeAllPopups();
    setAgentIdx(0);
    setModelIdx(0);

    // If there's a template, select the first placeholder so user can type over it
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      if (template) {
        const fullVal = el.value;
        const start = fullVal.indexOf("[");
        const end = fullVal.indexOf("]");
        if (start !== -1 && end !== -1) {
          el.setSelectionRange(start, end + 1);
        }
      } else {
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  };

  const selectSemanticView = (id: string, name: string) => {
    setValue((v) => v.slice(0, v.lastIndexOf("//")) + `@${name} `);
    setSelectedViewId(id);
    setSlashTwoPopup(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // ---------------------------------------------------------------------------
  // Change handler
  // ---------------------------------------------------------------------------

  const handleChange = (newVal: string) => {
    setValue(newVal);
    historyIdxRef.current = -1; // exit history cycling on any typing

    // Close feature popup when text changes (user typed manually)
    if (featurePopup) {
      // Update the filter query based on what's inside the current bracket
      const el = textareaRef.current;
      if (el) {
        const cursor = el.selectionEnd;
        const before = newVal.slice(0, cursor);
        const openIdx = before.lastIndexOf("[");
        if (openIdx !== -1) {
          const typed = before.slice(openIdx + 1);
          setFeatureQuery(typed);
          setFeatureIdx(0);
        } else {
          setFeaturePopup(false);
        }
      }
    }

    if (newVal.endsWith("//")) {
      setSlashTwoPopup(true);
      setSlashTwoIdx(0);
      setAgentPopup(false);
      setInModelMenu(false);
    } else if (newVal.endsWith("/")) {
      setAgentPopup(true);
      setAgentIdx(0);
      setInModelMenu(false);
      setModelIdx(0);
      setSlashTwoPopup(false);
    } else if (!featurePopup) {
      closeAllPopups();
    }
  };

  // ---------------------------------------------------------------------------
  // Keyboard handler
  // ---------------------------------------------------------------------------

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // ── Feature column picker ───────────────────────────────────────────────
    if (featurePopup && filteredColumns.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFeatureIdx((i) => Math.min(i + 1, filteredColumns.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFeatureIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        insertColumn(filteredColumns[featureIdx]);
        return;
      }
      if (e.key === "Tab") {
        // Insert selected column then advance to next placeholder
        e.preventDefault();
        const col = filteredColumns[featureIdx];
        const el = textareaRef.current;
        if (!el) return;
        const text = el.value;
        const selStart = el.selectionStart;
        const selEnd = el.selectionEnd;
        const newText = text.slice(0, selStart) + col + text.slice(selEnd);
        setValue(newText);
        setFeaturePopup(false);
        setFeatureQuery("");
        requestAnimationFrame(() => {
          if (!textareaRef.current) return;
          textareaRef.current.value = newText;
          const pos = selStart + col.length;
          textareaRef.current.setSelectionRange(pos, pos);
          cycleToNextPlaceholder({ preventDefault: () => {} });
        });
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setFeaturePopup(false);
        return;
      }
    }

    // ── "//" semantic model popup ───────────────────────────────────────────
    if (slashTwoPopup) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashTwoIdx((i) => Math.min(i + 1, views.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSlashTwoIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const v = views[slashTwoIdx];
        if (v) selectSemanticView(v.id, v.displayName);
        return;
      }
      if (e.key === "Escape") { setSlashTwoPopup(false); return; }
    }

    // ── "/" agent picker popup ──────────────────────────────────────────────
    if (agentPopup) {
      const currentAgent = AGENT_OPTIONS[agentIdx];
      const hasModels = !!currentAgent.models?.length;

      if (!inModelMenu) {
        // Navigating agent list
        if (e.key === "ArrowDown") { e.preventDefault(); setAgentIdx((i) => Math.min(i + 1, AGENT_OPTIONS.length - 1)); setModelIdx(0); return; }
        if (e.key === "ArrowUp")   { e.preventDefault(); setAgentIdx((i) => Math.max(i - 1, 0)); setModelIdx(0); return; }
        if (e.key === "ArrowRight" && hasModels) { e.preventDefault(); setInModelMenu(true); setModelIdx(0); return; }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          if (hasModels) { setInModelMenu(true); setModelIdx(0); }
          else            { selectAgentModel(agentIdx); }
          return;
        }
      } else {
        // Navigating model sub-menu
        const models = currentAgent.models!;
        if (e.key === "ArrowDown")  { e.preventDefault(); setModelIdx((i) => Math.min(i + 1, models.length - 1)); return; }
        if (e.key === "ArrowUp")    { e.preventDefault(); setModelIdx((i) => Math.max(i - 1, 0)); return; }
        if (e.key === "ArrowLeft")  { e.preventDefault(); setInModelMenu(false); return; }
        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectAgentModel(agentIdx, modelIdx); return; }
      }

      if (e.key === "Escape") { closeAllPopups(); return; }
    }

    // ── Tab: cycle through [placeholders] ─────────────────────────────────
    if (e.key === "Tab" && !agentPopup && !slashTwoPopup) {
      const placeholders = findPlaceholders(value);
      if (placeholders.length > 0) {
        cycleToNextPlaceholder(e);
        return;
      }
    }

    // ── Prompt history cycling ─────────────────────────────────────────────
    if (e.key === "ArrowUp" && history.length > 0) {
      const alreadyCycling = historyIdxRef.current >= 0;
      if (alreadyCycling || value.trim() === "") {
        e.preventDefault();
        if (!alreadyCycling) { draftRef.current = value; historyIdxRef.current = 0; }
        else                 { historyIdxRef.current = Math.min(historyIdxRef.current + 1, history.length - 1); }
        setValue(history[historyIdxRef.current]);
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) { el.selectionStart = el.value.length; el.selectionEnd = el.value.length; }
        });
        return;
      }
    }
    if (e.key === "ArrowDown" && historyIdxRef.current >= 0) {
      e.preventDefault();
      historyIdxRef.current -= 1;
      setValue(historyIdxRef.current < 0 ? draftRef.current : history[historyIdxRef.current]);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) { el.selectionStart = el.value.length; el.selectionEnd = el.value.length; }
      });
      return;
    }

    // ── Submit ─────────────────────────────────────────────────────────────
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    historyIdxRef.current = -1;
    draftRef.current = "";
    onSubmit(trimmed);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const selectedView = views.find((v) => v.id === selectedViewId);
  const isStreaming = disabled && !!onAbort;
  const currentAgent = AGENT_OPTIONS[agentIdx];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div ref={containerRef} className="flex flex-col gap-1.5 relative">

      {/* "/" agent picker popup ─────────────────────────────────────────── */}
      {agentPopup && (
        <div
          className="absolute bottom-full left-0 mb-1 z-50 flex rounded-xl shadow-xl overflow-hidden"
          style={{ background: "#ffffff", border: "1px solid var(--border)" }}
        >
          {/* Agent list */}
          <div style={{ minWidth: 220, borderRight: currentAgent.models ? "1px solid var(--border)" : "none" }}>
            <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Select agent</p>
              <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>↑↓ navigate · → models · Enter select · Esc close</p>
            </div>
            {AGENT_OPTIONS.map((agent, i) => (
              <button
                key={agent.id}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
                style={{
                  background: i === agentIdx && !inModelMenu ? "var(--accent-dim)" : i === agentIdx ? "var(--bg-secondary)" : "transparent",
                  borderBottom: i < AGENT_OPTIONS.length - 1 ? "1px solid var(--border)" : "none",
                }}
                onMouseEnter={() => { setAgentIdx(i); setInModelMenu(false); setModelIdx(0); }}
                onClick={() => {
                  if (agent.models) { setAgentIdx(i); setInModelMenu(true); setModelIdx(0); }
                  else              { selectAgentModel(i); }
                }}
              >
                <span
                  className="flex items-center justify-center w-6 h-6 rounded shrink-0"
                  style={{ background: "var(--bg-tertiary)" }}
                >
                  <agent.icon size={13} style={{ color: "#111111" }} strokeWidth={1.5} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>{agent.label}</p>
                  <p className="truncate" style={{ fontSize: "10px", color: "var(--text-muted)" }}>{agent.description}</p>
                </div>
                {agent.models && (
                  <ChevronRight size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                )}
              </button>
            ))}
          </div>

          {/* Model sub-list — appears when hovered agent has models */}
          {currentAgent.models && (
            <div style={{ minWidth: 230 }}>
              <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Select model</p>
                <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>↑↓ navigate · Enter select · ← back</p>
              </div>
              {currentAgent.models.map((model, i) => (
                <button
                  key={model.id}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
                  style={{
                    background: inModelMenu && i === modelIdx ? "var(--accent-dim)" : "transparent",
                    borderBottom: i < (currentAgent.models?.length ?? 0) - 1 ? "1px solid var(--border)" : "none",
                  }}
                  onMouseEnter={() => { setInModelMenu(true); setModelIdx(i); }}
                  onClick={() => selectAgentModel(agentIdx, i)}
                >
                  {model.id === "auto" ? (
                    <Star size={12} style={{ color: "#111111", flexShrink: 0 }} />
                  ) : (
                    <span style={{ width: 12, flexShrink: 0 }} />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {model.label}
                    </p>
                    <p className="truncate" style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                      {model.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* "//" semantic model popup ─────────────────────────────────────── */}
      {slashTwoPopup && views.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-1 z-50 rounded-xl shadow-xl overflow-hidden"
          style={{ background: "#ffffff", border: "1px solid var(--border)", minWidth: 220 }}
        >
          <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Select semantic model</p>
            <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>Tab or Enter to select · Esc to dismiss</p>
          </div>
          {views.map((v, i) => (
            <button
              key={v.id}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
              style={{
                background: i === slashTwoIdx ? "var(--accent-dim)" : "transparent",
                borderBottom: i < views.length - 1 ? "1px solid var(--border)" : "none",
              }}
              onMouseEnter={() => setSlashTwoIdx(i)}
              onClick={() => selectSemanticView(v.id, v.displayName)}
            >
              <Database size={13} style={{ color: "#111111", flexShrink: 0 }} />
              <div>
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{v.displayName}</p>
                <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>{v.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Feature column picker popup ───────────────────────────────────── */}
      {featurePopup && viewColumns.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-1 z-50 rounded-xl shadow-xl overflow-hidden"
          style={{ background: "#ffffff", border: "1px solid var(--border)", minWidth: 280, maxWidth: 380 }}
        >
          <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
              Available columns
              <span className="ml-1.5 font-normal" style={{ color: "var(--text-muted)" }}>
                ({filteredColumnItems.length}{featureQuery ? ` of ${viewColumns.length}` : ""})
              </span>
            </p>
            <p style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              Type to filter · ↑↓ navigate · Enter or Tab to insert · Esc dismiss
            </p>
          </div>
          <div
            ref={featureListRef}
            style={{ maxHeight: 260, overflowY: "auto" }}
          >
            {filteredColumnItems.length === 0 ? (
              <p className="px-3 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                No columns match &ldquo;{featureQuery}&rdquo;
              </p>
            ) : (() => {
              // Render with table group headers (when not filtering by query)
              const items: React.ReactNode[] = [];
              let lastTable = "";
              filteredColumnItems.forEach((item, i) => {
                // Show table group header whenever the table changes (skip in search mode)
                if (!featureQuery && item.table && item.table !== lastTable) {
                  lastTable = item.table;
                  items.push(
                    <div
                      key={`grp-${item.table}`}
                      className="px-3 py-1.5 flex items-center gap-1.5"
                      style={{
                        background: "var(--bg-secondary)",
                        borderBottom: "1px solid var(--border)",
                        position: "sticky",
                        top: 0,
                        zIndex: 1,
                      }}
                    >
                      <Database size={10} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                      <span
                        className="font-mono font-semibold uppercase tracking-wide"
                        style={{ fontSize: "9px", color: "var(--text-muted)" }}
                      >
                        {item.table}
                      </span>
                    </div>
                  );
                }
                items.push(
                  <button
                    key={`${item.table}-${item.col}`}
                    data-feature-idx={i}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
                    style={{
                      background: i === featureIdx ? "var(--accent-dim)" : "transparent",
                      borderBottom: i < filteredColumnItems.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                    onMouseEnter={() => setFeatureIdx(i)}
                    onClick={() => insertColumn(item.col)}
                  >
                    <span
                      className="font-mono text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)", fontSize: "10px" }}
                    >
                      col
                    </span>
                    <span className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                      {item.col}
                    </span>
                  </button>
                );
              });
              return items;
            })()}
          </div>
        </div>
      )}

      {/* Input box ────────────────────────────────────────────────────────── */}
      <div
        className="flex items-end gap-3 rounded-xl px-4 py-3"
        style={{
          background: "#ffffff",
          border: `1px solid ${isStreaming ? "rgba(239,68,68,0.35)" : "var(--border)"}`,
        }}
      >
        {/* Semantic view selector */}
        {views.length > 0 && (
          <div className="relative shrink-0">
            <button
              onClick={() => setShowPicker((v) => !v)}
              disabled={isStreaming}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors hover:bg-black/5 disabled:opacity-40"
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
                    <Database size={12} style={{ color: "#111111", flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{v.displayName}</p>
                      <p className="truncate" style={{ color: "var(--text-muted)", fontSize: "10px" }}>{v.description}</p>
                    </div>
                    {selectedViewId === v.id && (
                      <span className="ml-auto text-xs shrink-0" style={{ color: "#111111" }}>✓</span>
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
          placeholder={isStreaming ? "Running analysis…" : placeholder}
          rows={1}
          disabled={isStreaming}
          className="flex-1 resize-none outline-none text-sm leading-relaxed bg-transparent disabled:opacity-50"
          style={{
            color: "var(--text-primary)",
            maxHeight: compact ? "120px" : "200px",
            overflowY: "auto",
            lineHeight: "1.5",
          }}
        />

        {isStreaming ? (
          <button
            onClick={onAbort}
            title="Stop"
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all shrink-0 hover:opacity-85"
            style={{ background: "#ef4444", color: "white" }}
          >
            <StopCircle size={16} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!value.trim() || disabled}
            title="Send (Enter)"
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all shrink-0"
            style={{
              background: value.trim() && !disabled ? "#2891DA" : "var(--bg-hover)",
              color:      value.trim() && !disabled ? "white"   : "var(--text-muted)",
              cursor:     value.trim() && !disabled ? "pointer" : "not-allowed",
            }}
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>

      {/* Help text ────────────────────────────────────────────────────────── */}
      {!isStreaming && (
        <div className="flex items-center gap-4 px-1" style={{ color: "var(--text-muted)" }}>
          <span className="flex items-center gap-1" style={{ fontSize: "11px" }}>
            <kbd
              className="px-1 py-0.5 rounded text-xs font-mono"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: "10px" }}
            >/</kbd>
            <span>select agent &amp; model</span>
          </span>
          <span className="flex items-center gap-1" style={{ fontSize: "11px" }}>
            <kbd
              className="px-1 py-0.5 rounded text-xs font-mono"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: "10px" }}
            >//</kbd>
            <span>select semantic model</span>
          </span>
          {findPlaceholders(value).length > 0 && (
            <span className="flex items-center gap-1" style={{ fontSize: "11px" }}>
              <kbd
                className="px-1 py-0.5 rounded text-xs font-mono"
                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: "10px" }}
              >Tab</kbd>
              <span>next field</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
