"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, BookOpen, Database, ChevronDown, Loader2 } from "lucide-react";
import ERDiagram from "@/components/data-explore/ERDiagram";
import ChatInput from "@/components/chat/ChatInput";
import { semanticTables, businessRules } from "@/lib/mock-data";
import { SemanticTable } from "@/lib/types";

// ---------------------------------------------------------------------------
// Real semantic views fetched from Snowflake
// ---------------------------------------------------------------------------

interface SemanticView {
  id: string;
  displayName: string;
  description: string;
  fullyQualifiedName: string;
  isDefault?: boolean;
}

// Static schema mapping: view id → tables that belong to it.
// "cortex_testcase" and "analytics" both map to the real CORTEX_TESTCASE schema.
const VIEW_SCHEMA: Record<string, SemanticTable[]> = {
  cortex_testcase: semanticTables,
  analytics: semanticTables,
};

function getTablesForView(view: SemanticView): SemanticTable[] {
  // Try by id first, then by a normalised id derived from the display name
  const byId = VIEW_SCHEMA[view.id];
  if (byId) return byId;
  const normalised = view.displayName.toLowerCase().replace(/\s+/g, "-");
  return VIEW_SCHEMA[normalised] ?? semanticTables; // fall back to main schema
}

// ---------------------------------------------------------------------------
// TableDetail
// ---------------------------------------------------------------------------

function TableDetail({ table }: { table: SemanticTable }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_COUNT = 5;
  const hasMore = table.columns.length > PREVIEW_COUNT;
  const displayCols = expanded ? table.columns : table.columns.slice(0, PREVIEW_COUNT);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--border)", background: "#ffffff" }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {table.name}
        </span>
        {hasMore && (
          <button
            className="text-xs transition-colors hover:underline"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        )}
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" }}>
            {["Column", "Type", "Description", "Samples"].map((h) => (
              <th key={h} className="px-4 py-2 text-left font-medium" style={{ color: "var(--text-muted)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayCols.map((col, i) => (
            <tr
              key={col.name}
              style={{ borderBottom: i < displayCols.length - 1 ? "1px solid var(--border)" : "none" }}
            >
              <td className="px-4 py-2 font-mono font-semibold" style={{ color: "var(--text-primary)" }}>
                {col.name}
              </td>
              <td className="px-4 py-2" style={{ color: "var(--text-muted)" }}>
                {col.type}
              </td>
              <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                {col.description}
              </td>
              <td className="px-4 py-2 font-mono" style={{ color: "var(--text-muted)" }}>
                {col.samples}
              </td>
            </tr>
          ))}
          {!expanded && table.columns.length > 5 && (
            <tr>
              <td
                colSpan={4}
                className="px-4 py-2 text-center text-xs cursor-pointer hover:bg-black/5"
                style={{ color: "var(--text-muted)" }}
                onClick={() => setExpanded(true)}
              >
                + {table.columns.length - 5} more columns
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DataExplorePage
// ---------------------------------------------------------------------------

export default function DataExplorePage() {
  const [views, setViews] = useState<SemanticView[]>([]);
  const [loadingViews, setLoadingViews] = useState(true);
  const [activeViewId, setActiveViewId] = useState<string>("");
  const [selectedTable, setSelectedTable] = useState<string>("rx-table");
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();

  // Fetch real semantic views from Snowflake on mount
  useEffect(() => {
    fetch("/api/semantic-views")
      .then((r) => r.json())
      .then((data: { views?: SemanticView[] }) => {
        const fetched = data.views ?? [];
        if (fetched.length > 0) {
          setViews(fetched);
          const def = fetched.find((v) => v.isDefault) ?? fetched[0];
          setActiveViewId(def.id);
        }
      })
      .catch(() => {
        // Fallback to the known real view
        const fallback: SemanticView = {
          id: "cortex_testcase",
          displayName: "Analytics",
          description: "Rx claims, drug reference, physicians & plan data",
          fullyQualifiedName: "CORTEX_TESTING.PUBLIC.CORTEX_TESTCASE",
          isDefault: true,
        };
        setViews([fallback]);
        setActiveViewId(fallback.id);
      })
      .finally(() => setLoadingViews(false));
  }, []);

  const activeView = views.find((v) => v.id === activeViewId);
  const activeTables = activeView ? getTablesForView(activeView) : semanticTables;

  // Reset selected table when view changes
  const handleViewChange = (id: string) => {
    setActiveViewId(id);
    const tables = getTablesForView(views.find((v) => v.id === id) ?? views[0]);
    if (tables.length > 0) setSelectedTable(tables[0].id);
  };

  // ── Search filtering ────────────────────────────────────────────────────────
  const q = searchQuery.toLowerCase();

  const filteredTables = q
    ? activeTables.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.columns.some(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              c.description.toLowerCase().includes(q) ||
              c.type.toLowerCase().includes(q),
          ),
      )
    : activeTables;

  // When search narrows the table list and the current selection is no longer
  // visible, auto-select the first result so the detail panel shows something.
  const visibleIds = new Set(filteredTables.map((t) => t.id));
  const activeTableId = visibleIds.has(selectedTable)
    ? selectedTable
    : (filteredTables[0]?.id ?? selectedTable);

  const activeTable = activeTables.find((t) => t.id === activeTableId);

  // Also narrow columns inside the detail panel when a query is active.
  const filteredDetailCols = q && activeTable
    ? activeTable.columns.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.type.toLowerCase().includes(q),
      )
    : activeTable?.columns ?? [];

  const filteredRules = q
    ? businessRules.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.definition.toLowerCase().includes(q) ||
          r.details.some((d) => d.toLowerCase().includes(q)),
      )
    : businessRules;

  return (
    <div
      className="flex flex-col h-full overflow-y-auto"
      style={{ background: "var(--bg-primary)" }}
    >
      <div className="px-5 py-4 flex flex-col gap-4 w-full">

        {/* Semantic view selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Database size={14} style={{ color: "var(--text-muted)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>Semantic Model:</span>
          </div>

          {loadingViews ? (
            <div className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
              <Loader2 size={13} className="animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : views.length > 1 ? (
            <div className="relative">
              <select
                value={activeViewId}
                onChange={(e) => handleViewChange(e.target.value)}
                className="appearance-none rounded-lg px-3 py-2 pr-8 text-sm font-medium outline-none transition-colors cursor-pointer"
                style={{
                  background: "#ffffff",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              >
                {views.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.displayName}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: "var(--text-muted)" }}
              />
            </div>
          ) : (
            /* Single view — show as a badge instead of a dropdown */
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            >
              <Database size={12} style={{ color: "#111111" }} />
              {activeView?.displayName ?? "Analytics"}
              <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>
                {activeView?.fullyQualifiedName ?? ""}
              </span>
            </div>
          )}
        </div>

        {/* Search bar */}
        <div
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
          style={{ background: "#ffffff", border: "1px solid var(--border)" }}
        >
          <Search size={15} style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tables, columns, business rules..."
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: "var(--text-primary)" }}
          />
        </div>

        {/* ER Diagram */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border)", background: "#ffffff" }}
        >
          <div
            className="flex items-center gap-2 px-4 py-2.5"
            style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)" }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {activeView?.displayName ?? "Analytics"}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full ml-1" style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
              {activeTables.length} tables
            </span>
            <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
              Click a table to view details
            </span>
          </div>
          <div className="p-4" style={{ background: "#ffffff" }}>
            <ERDiagram
              tables={filteredTables}
              selectedTable={activeTableId}
              onSelectTable={setSelectedTable}
            />
            {filteredTables.length === 0 && q && (
              <p className="text-xs text-center py-6" style={{ color: "var(--text-muted)" }}>
                No tables match &ldquo;{searchQuery}&rdquo;
              </p>
            )}
          </div>
        </div>

        {/* Table detail */}
        {activeTable && (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>
              Table Detail: {activeTable.name}
              {q && filteredDetailCols.length !== activeTable.columns.length && (
                <span className="ml-2" style={{ color: "var(--accent)" }}>
                  — {filteredDetailCols.length} of {activeTable.columns.length} columns match
                </span>
              )}
            </p>
            <TableDetail
              table={q ? { ...activeTable, columns: filteredDetailCols.length > 0 ? filteredDetailCols : activeTable.columns } : activeTable}
            />
          </div>
        )}

        {/* Business Rules */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border)", background: "#ffffff" }}
        >
          <div
            className="flex items-center gap-2 px-4 py-2.5"
            style={{ background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" }}
          >
            <BookOpen size={14} style={{ color: "var(--text-muted)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Business Rules & Definitions
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {filteredRules.map((rule) => (
              <div key={rule.name} className="px-4 py-3">
                <div className="flex items-start gap-2 mb-1">
                  <div>
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {rule.name}
                    </span>
                    <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>
                      = {rule.definition}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-0.5">
                  {rule.details.map((d, i) => (
                    <p key={i} className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {d}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Inline chat */}
        <div className="pb-4">
          <ChatInput
            placeholder="Ask a question about this data..."
            onSubmit={() => router.push(`/chat/thread-1`)}
          />
        </div>
      </div>
    </div>
  );
}
