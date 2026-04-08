"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare, Search, Zap, Plus, Pencil, Trash2, Check,
  PanelLeftClose, PanelLeftOpen, ChevronDown, ChevronRight,
} from "lucide-react";
import { chatThreads as initialThreads } from "@/lib/mock-data";
import { clsx } from "clsx";
import { useState } from "react";

interface LeftRailProps {
  collapsed?: boolean;
  narrow?: boolean;
  onToggleCollapse?: () => void;
}

const TODAY = new Date(2026, 3, 8);
const MONTH_MAP: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseDateStr(s: string): Date {
  const [mon, day] = s.split(" ");
  const month = MONTH_MAP[mon] ?? 3;
  return new Date(month > TODAY.getMonth() ? 2025 : 2026, month, parseInt(day));
}

function getGroup(dateStr: string): "week" | "month" | "older" {
  const days = Math.round((TODAY.getTime() - parseDateStr(dateStr).getTime()) / 86400000);
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  return "older";
}

const GROUP_LABELS: Record<string, string> = {
  week: "This Week",
  month: "This Month",
  older: "Older",
};

export default function LeftRail({ collapsed = false, narrow = false, onToggleCollapse }: LeftRailProps) {
  const pathname = usePathname();
  const isChat = pathname.startsWith("/chat");

  const [threads, setThreads] = useState(initialThreads);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const navItems = [
    { href: "/chat", label: "Chat", icon: MessageSquare },
    { href: "/workflows", label: "Flows", icon: Zap },
    { href: "/data-explore", label: "Data", icon: Search },
  ];

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const commitRename = (id: string) => {
    if (renameValue.trim())
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title: renameValue.trim() } : t)));
    setRenamingId(null);
  };

  const groups = (["week", "month", "older"] as const)
    .map((key) => ({ key, label: GROUP_LABELS[key], items: threads.filter((t) => getGroup(t.date) === key) }))
    .filter((g) => g.items.length > 0);

  // Nav layout: expanded = horizontal row, narrow/collapsed = vertical column
  const navLayout = collapsed || narrow ? "flex-col items-center gap-0.5" : "flex-row items-center gap-0";

  return (
    <aside style={{ background: "var(--bg-secondary)" }} className="flex flex-col h-full w-full overflow-hidden">

      {/* Nav items */}
      <nav className={`flex pt-3 pb-1 px-2 ${collapsed || narrow ? "flex-col gap-0.5" : "flex-col gap-0.5"}`}>
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={`flex items-center rounded-lg transition-colors px-2 py-2 ${collapsed || narrow ? "flex-col gap-0.5 justify-center" : "flex-row gap-2.5"}`}
              style={active
                ? { background: "var(--accent-dim)", color: "var(--accent)" }
                : { color: "var(--text-muted)" }}
            >
              <Icon size={18} />
              {!collapsed && (
                <span style={{
                  fontSize: narrow ? "10px" : "12px",
                  fontWeight: 500,
                  letterSpacing: "0.01em",
                  whiteSpace: "nowrap",
                }}>
                  {label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Thread list — chat section, expanded only */}
      {isChat && !collapsed && (
        <div className="flex-1 overflow-y-auto" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="px-2 pt-2 pb-1">
            <Link
              href="/chat"
              className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-md transition-colors"
              style={{ color: "var(--accent)", background: "var(--accent-dim)", fontSize: "11px", fontWeight: 500 }}
            >
              <Plus size={11} />
              {!narrow && <span>New Chat</span>}
            </Link>
          </div>

          {groups.map(({ key, label, items }) => {
            const isGroupCollapsed = collapsedGroups.has(key);
            return (
              <div key={key} className="mb-1">
                {/* Group header — collapsible, light color */}
                <button
                  onClick={() => toggleGroup(key)}
                  className="w-full flex items-center gap-1 px-3 py-1 transition-colors hover:bg-black/4"
                >
                  <span
                    style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", color: "#A0A0A0", textTransform: "uppercase", flex: 1, textAlign: "left" }}
                  >
                    {narrow ? label.charAt(0) : label}
                  </span>
                  {isGroupCollapsed
                    ? <ChevronRight size={10} style={{ color: "#A0A0A0" }} />
                    : <ChevronDown size={10} style={{ color: "#A0A0A0" }} />}
                </button>

                {!isGroupCollapsed && items.map((t) => (
                  <div
                    key={t.id}
                    className="relative"
                    onMouseEnter={() => setHoveredId(t.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {renamingId === t.id ? (
                      <div className="flex items-center gap-1 px-2 py-1.5 mx-1">
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(t.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          className="flex-1 rounded px-1.5 py-0.5 outline-none"
                          style={{ fontSize: "11px", color: "var(--text-primary)", background: "var(--bg-primary)", border: "1px solid var(--accent)" }}
                        />
                        <button onClick={() => commitRename(t.id)} className="p-0.5 rounded hover:bg-black/5" style={{ color: "var(--accent)" }}>
                          <Check size={11} />
                        </button>
                      </div>
                    ) : (
                      <Link
                        href={`/chat/${t.id}`}
                        title={t.title}
                        className={clsx(
                          "flex items-center px-2 py-1.5 mx-1 rounded-md transition-colors",
                          pathname === `/chat/${t.id}` ? "bg-black/5" : "hover:bg-black/4"
                        )}
                        style={{ paddingRight: hoveredId === t.id ? "52px" : "8px" }}
                      >
                        <span
                          className="text-xs truncate block w-full"
                          style={{ color: "var(--text-secondary)", lineHeight: 1.4 }}
                        >
                          {t.title}
                        </span>
                      </Link>
                    )}

                    {/* Hover icons */}
                    {hoveredId === t.id && renamingId !== t.id && (
                      <div
                        className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5"
                        style={{ background: "var(--bg-secondary)" }}
                      >
                        <button
                          onClick={(e) => { e.preventDefault(); setRenamingId(t.id); setRenameValue(t.title); }}
                          className="p-1 rounded hover:bg-black/5 transition-colors"
                          style={{ color: "var(--text-muted)" }}
                          title="Rename"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={(e) => { e.preventDefault(); setThreads((prev) => prev.filter((x) => x.id !== t.id)); }}
                          className="p-1 rounded hover:bg-black/5 transition-colors"
                          style={{ color: "var(--text-muted)" }}
                          title="Delete"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Spacer to push collapse button to bottom */}
      {(!isChat || collapsed) && <div className="flex-1" />}

      {/* Collapse toggle — pinned to bottom */}
      <button
        onClick={onToggleCollapse}
        className="flex items-center justify-center py-2 mx-2 mb-2 rounded-lg transition-colors hover:bg-black/5"
        style={{ color: "var(--text-muted)" }}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
    </aside>
  );
}
