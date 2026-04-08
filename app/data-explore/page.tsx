"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, BookOpen, Database, ChevronDown } from "lucide-react";
import ERDiagram from "@/components/data-explore/ERDiagram";
import ChatInput from "@/components/chat/ChatInput";
import { semanticModels, businessRules } from "@/lib/mock-data";
import { SemanticTable } from "@/lib/types";

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

export default function DataExplorePage() {
  const [activeModelId, setActiveModelId] = useState(semanticModels[0].id);
  const [selectedTable, setSelectedTable] = useState<string>("rx-table");
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();

  const activeModel = semanticModels.find((m) => m.id === activeModelId) ?? semanticModels[0];

  // Reset selected table when model changes
  const handleModelChange = (id: string) => {
    setActiveModelId(id);
    const model = semanticModels.find((m) => m.id === id);
    if (model?.tables.length) setSelectedTable(model.tables[0].id);
  };

  const activeTable = activeModel.tables.find((t) => t.id === selectedTable);

  const filteredRules = searchQuery
    ? businessRules.filter(
        (r) =>
          r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.definition.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : businessRules;

  return (
    <div
      className="flex flex-col h-full overflow-y-auto"
      style={{ background: "var(--bg-primary)" }}
    >
      <div className="px-5 py-4 flex flex-col gap-4 w-full">

        {/* Semantic model dropdown */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Database size={14} style={{ color: "var(--text-muted)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>Semantic Model:</span>
          </div>
          <div className="relative">
            <select
              value={activeModelId}
              onChange={(e) => handleModelChange(e.target.value)}
              className="appearance-none rounded-lg px-3 py-2 pr-8 text-sm font-medium outline-none transition-colors cursor-pointer"
              style={{
                background: "#ffffff",
                border: "1px solid var(--border)",
                color: "var(--text-primary)",
              }}
            >
              {semanticModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "var(--text-muted)" }}
            />
          </div>
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
              {activeModel.name}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full ml-1" style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
              {activeModel.tables.length} tables
            </span>
            <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
              Click a table to view details
            </span>
          </div>
          <div className="p-4" style={{ background: "#ffffff" }}>
            <ERDiagram
              tables={activeModel.tables}
              selectedTable={selectedTable}
              onSelectTable={setSelectedTable}
            />
          </div>
        </div>

        {/* Table detail */}
        {activeTable && (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>
              Table Detail: {activeTable.name}
            </p>
            <TableDetail table={activeTable} />
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

        {/* Inline chat — no prompt text */}
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
