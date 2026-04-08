"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, User, ChevronRight, LogOut, ChevronDown } from "lucide-react";

function getBreadcrumb(pathname: string): string[] {
  if (pathname === "/chat" || pathname === "/") return [];
  if (pathname.startsWith("/chat/")) return ["Thread"];
  if (pathname === "/data-explore") return ["Data Explore"];
  if (pathname === "/workflows") return ["Workflows"];
  if (pathname.startsWith("/workflows/") && pathname.endsWith("/edit"))
    return ["Workflows", "Payer Segmentation Pipeline"];
  if (pathname.startsWith("/workflows/") && pathname.includes("/run"))
    return ["Workflows", "Payer Segmentation Pipeline", "Run #14"];
  if (pathname.startsWith("/workflows/"))
    return ["Workflows", "Payer Segmentation Pipeline"];
  return [];
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors hover:bg-black/7"
        style={{ color: "var(--text-secondary)" }}
      >
        <User size={15} />
        <span>Harshad</span>
        <ChevronDown size={13} style={{ opacity: 0.5 }} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-48 rounded-xl overflow-hidden z-50"
          style={{
            background: "#ffffff",
            border: "1px solid var(--border)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.10)",
          }}
        >
          <div
            className="px-3 py-2.5"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
              Harshad Chiddarwar
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              harshad@sr.com
            </p>
          </div>
          <button
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-black/5 text-left"
            style={{ color: "var(--danger)" }}
            onClick={() => setOpen(false)}
          >
            <LogOut size={14} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  const pathname = usePathname();
  const breadcrumbs = getBreadcrumb(pathname);

  return (
    <header
      className="flex items-center justify-between px-5 shrink-0"
      style={{
        height: "56px",
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Logo + breadcrumbs */}
      <div className="flex items-center gap-2">
        <Link href="/chat" className="flex items-center" style={{ display: "inline-flex", alignItems: "baseline" }}>
          <span className="brand-gradient font-bold text-xl tracking-tight leading-none">SRIntelligence</span>
          <span className="brand-gradient" style={{ fontSize: "10px", fontWeight: 400, marginLeft: "1px", lineHeight: 1 }}>™</span>
        </Link>

        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-2">
            <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />
            <span
              className="text-sm"
              style={{
                color:
                  i === breadcrumbs.length - 1
                    ? "var(--text-secondary)"
                    : "var(--text-muted)",
              }}
            >
              {crumb}
            </span>
          </span>
        ))}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2">
        <button
          className="p-1.5 rounded-lg transition-colors hover:bg-black/7"
          style={{ color: "var(--text-muted)" }}
          title="Settings"
        >
          <Settings size={16} />
        </button>
        <UserMenu />
      </div>
    </header>
  );
}
