"use client";

import { useState, useRef, useCallback, ReactNode } from "react";
import LeftRail from "./LeftRail";
import { ChatHistoryProvider } from "@/components/providers/ChatHistoryProvider";

const MIN_WIDTH = 100;
const MAX_WIDTH = 320;
const DEFAULT_WIDTH = 160;
const COLLAPSED_WIDTH = 64;

export default function ResizableLayout({ children }: { children: ReactNode }) {
  const [railWidth, setRailWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const handleRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (collapsed) return;
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = railWidth;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth.current + ev.clientX - startX.current));
        setRailWidth(next);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [collapsed, railWidth]
  );

  const effectiveWidth = collapsed ? COLLAPSED_WIDTH : railWidth;

  const narrow = !collapsed && railWidth < 130;

  return (
    <ChatHistoryProvider>
      <div className="flex flex-1 overflow-hidden">
        {/* Rail */}
        <div style={{ width: effectiveWidth, transition: "width 0.18s ease" }} className="shrink-0 overflow-hidden relative">
          <LeftRail collapsed={collapsed} narrow={narrow} onToggleCollapse={() => setCollapsed((v) => !v)} />
        </div>

        {/* Invisible drag handle — shows col-resize cursor on hover */}
        <div
          ref={handleRef}
          onMouseDown={onMouseDown}
          className="w-2 shrink-0 hover:bg-black/8 transition-colors"
          style={{
            cursor: collapsed ? "default" : "col-resize",
            background: "transparent",
          }}
        />

        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </ChatHistoryProvider>
  );
}
