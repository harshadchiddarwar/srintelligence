"use client";

import { useState } from "react";
import { FileSpreadsheet, Maximize2, ChevronDown, ChevronUp } from "lucide-react";
import { TableData } from "@/lib/types";
import DownloadDialog from "@/components/ui/DownloadDialog";
import FullscreenOverlay from "@/components/ui/FullscreenOverlay";

function TableContent({ data }: { data: TableData }) {
  const isPositive = (val: string | number) => {
    if (typeof val !== "string") return null;
    if (val.startsWith("+")) return true;
    if (val.startsWith("-")) return false;
    return null;
  };

  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
          {data.headers.map((h, i) => (
            <th key={i} className="px-3 py-2 text-left font-medium" style={{ color: "var(--text-muted)" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row, ri) => (
          <tr
            key={ri}
            style={{
              borderBottom: ri < data.rows.length - 1 ? "1px solid var(--border)" : "none",
              background: "#ffffff",
            }}
          >
            {row.map((cell, ci) => {
              const dir = isPositive(cell);
              return (
                <td
                  key={ci}
                  className="px-3 py-2"
                  style={{
                    color: dir === true ? "var(--success)" : dir === false ? "var(--danger)" : "var(--text-primary)",
                  }}
                >
                  {cell}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DataTable({ data }: { data: TableData }) {
  const [showCsvDialog, setShowCsvDialog] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const collapsible = data.rows.length > 5;
  const [collapsed, setCollapsed] = useState(collapsible);

  const downloadCSV = (filename: string) => {
    const header = data.headers.join(",");
    const rows = data.rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const csv = `${header}\n${rows}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toolbar = (
    <div className="flex items-center gap-1 px-2 py-1.5" style={{ borderBottom: collapsed ? "none" : "1px solid var(--border)", background: "var(--bg-secondary)" }}>
      <span className="flex-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {data.headers.length} columns · {data.rows.length} rows
      </span>
      {collapsible && (
        <button
          onClick={() => setCollapsed(v => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-black/5"
          style={{ color: "var(--text-muted)" }}
          title={collapsed ? "Show table" : "Hide table"}
        >
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          {collapsed ? "Show" : "Hide"}
        </button>
      )}
      <button
        onClick={() => setShowCsvDialog(true)}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-black/5"
        style={{ color: "var(--text-muted)" }}
        title="Download CSV"
      >
        <FileSpreadsheet size={12} />
        CSV
      </button>
      <button
        onClick={() => setFullscreen(true)}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-black/5"
        style={{ color: "var(--text-muted)" }}
        title="Expand fullscreen"
      >
        <Maximize2 size={12} />
      </button>
    </div>
  );

  return (
    <>
      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)", background: "#ffffff" }}>
        {toolbar}
        {!collapsed && <TableContent data={data} />}
      </div>

      {showCsvDialog && (
        <DownloadDialog
          defaultName="data-export"
          extension="csv"
          onConfirm={downloadCSV}
          onClose={() => setShowCsvDialog(false)}
        />
      )}

      {fullscreen && (
        <FullscreenOverlay title="Table" onClose={() => setFullscreen(false)}>
          <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
            <TableContent data={data} />
          </div>
        </FullscreenOverlay>
      )}
    </>
  );
}
