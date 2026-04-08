"use client";

import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";

interface FullscreenOverlayProps {
  onClose: () => void;
  children: ReactNode;
  title?: string;
}

export default function FullscreenOverlay({ onClose, children, title }: FullscreenOverlayProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#ffffff" }}
    >
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {title ?? ""}
        </span>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors hover:bg-black/5"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={14} />
          Close
        </button>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {children}
      </div>
    </div>
  );
}
