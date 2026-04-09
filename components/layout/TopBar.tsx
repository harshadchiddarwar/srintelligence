"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Settings, User, LogOut, ChevronDown } from "lucide-react";

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
          <div className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
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
  return (
    <header
      className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0"
      style={{
        background: "#F9F8F4",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* Logo */}
      {/*
        fontSize 28px (text-3xl) on the brand name.
        ™ sup: 0.5em = 14px, verticalAlign 0.6em = 8.4px — same 30%-of-parent
        ratio maintained.
        Subtitle: 11px (text-xs), 600 weight, wide tracking.
      */}
      <Link
        href="/chat"
        className="flex flex-col gap-0"
        style={{ textDecoration: "none" }}
      >
        <div
          className="flex items-baseline gap-0 font-bold tracking-tight"
          style={{ fontSize: "28px", lineHeight: 1.15 }}
        >
          <span className="brand-gradient">SRIntelligence</span>
          <sup
            className="brand-gradient"
            style={{ fontSize: "0.5em", fontWeight: 500, verticalAlign: "0.6em", lineHeight: 1, marginLeft: "1px" }}
          >™</sup>
        </div>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.10em",
            color: "#0f172a",
            lineHeight: 1,
            marginTop: "7px",
          }}
        >
          STRATEGIC RESEARCH INSIGHTS, INC.
        </span>
      </Link>

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
