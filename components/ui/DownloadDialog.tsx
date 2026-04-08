"use client";

import { useState } from "react";
import { X, Download } from "lucide-react";

interface DownloadDialogProps {
  defaultName: string;
  extension: string;
  onConfirm: (filename: string) => void;
  onClose: () => void;
}

export default function DownloadDialog({ defaultName, extension, onConfirm, onClose }: DownloadDialogProps) {
  const [name, setName] = useState(defaultName);

  const handleDownload = () => {
    if (!name.trim()) return;
    onConfirm(name.trim());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-xl shadow-2xl w-80 overflow-hidden"
        style={{ background: "#ffffff", border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Download as .{extension}
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/5 transition-colors" style={{ color: "var(--text-muted)" }}>
            <X size={14} />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-muted)" }}>
              File name
            </label>
            <div className="flex items-center rounded-lg overflow-hidden" style={{ border: "1px solid var(--border)" }}>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleDownload()}
                className="flex-1 px-3 py-2 text-sm outline-none bg-transparent"
                style={{ color: "var(--text-primary)" }}
              />
              <span
                className="px-3 py-2 text-xs shrink-0"
                style={{ background: "var(--bg-secondary)", color: "var(--text-muted)", borderLeft: "1px solid var(--border)" }}
              >
                .{extension}
              </span>
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
              File will be saved to your default downloads folder.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-black/5"
              style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}
            >
              Cancel
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-90"
              style={{ background: "#2891DA", color: "white" }}
            >
              <Download size={12} />
              Download
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
