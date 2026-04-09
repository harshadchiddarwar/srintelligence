"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock } from "lucide-react";
import ChatInput from "@/components/chat/ChatInput";
import { useChatHistory } from "@/components/providers/ChatHistoryProvider";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function newThreadId() {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function ChatHome() {
  const router = useRouter();
  const { threads } = useChatHistory();
  const recentThreads = threads.slice(0, 5);

  const handleSubmit = (query: string) => {
    const id = newThreadId();
    // Stash the first query so the thread page can fire it immediately
    sessionStorage.setItem(`pendingQuery:${id}`, query);
    router.push(`/chat/${id}`);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-primary)" }}>
      {/* Center content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        {/* Brand + greeting */}
        <div className="text-center">
          {/*
            Both elements carry brand-gradient individually — each clips its own
            background to its own text. Same keyframe/timing → looks like one
            continuous animated gradient.
            verticalAlign "0.6em" = 0.6 × sup-font-size(15px) = 9px above baseline
            = 30% of parent 30px — identical ratio to TopBar (30%).
          */}
          <h1 className="font-bold tracking-tight mb-1" style={{ fontSize: "30px", lineHeight: 1.2 }}>
            <span className="brand-gradient">SRIntelligence</span>
            <sup
              className="brand-gradient"
              style={{ fontSize: "0.5em", fontWeight: 500, verticalAlign: "0.6em", lineHeight: 1, marginLeft: "1px" }}
            >™</sup>
          </h1>
          <div
            className="w-24 h-px mx-auto mb-5"
            style={{ background: "var(--border)" }}
          />
          <p className="text-2xl font-medium mb-1" style={{ color: "var(--text-primary)" }}>
            {getGreeting()}, Harshad
          </p>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            What would you like to analyze?
          </p>

        </div>

        {/* Recent analyses */}
        {recentThreads.length > 0 && (
          <div className="w-full max-w-4xl">
            <div
              className="px-1 py-2 flex items-center gap-2 text-xs font-medium mb-2"
              style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}
            >
              <Clock size={12} />
              Recent Analyses
            </div>
            <div className="flex flex-col gap-1.5">
              {recentThreads.map((t) => (
                <Link
                  key={t.id}
                  href={`/chat/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg transition-colors hover:opacity-80"
                  style={{ background: "var(--bg-secondary)" }}
                >
                  <Clock size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  <span className="text-sm flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                    {t.title}
                  </span>
                  <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>
                    {t.date}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Chat input pinned to bottom */}
      <div className="px-6 pb-6 max-w-4xl w-full mx-auto">
        <ChatInput
          placeholder="▌ Ask a question about your data…"
          onSubmit={handleSubmit}
          autoFocus
        />
      </div>
    </div>
  );
}
