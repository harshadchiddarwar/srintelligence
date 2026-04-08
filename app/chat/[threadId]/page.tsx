"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Pin, Sparkles, AlertCircle, ChevronDown } from "lucide-react";
import ChatInput from "@/components/chat/ChatInput";
import ChatMessageComponent from "@/components/chat/ChatMessage";
import { ChatMessage, ChatThread } from "@/lib/types";

// ── Cortex Analyst history entry (mirrors server-side type) ──────────────────
interface CortexEntry {
  role: "user" | "analyst";
  content: Array<{ type: string; text?: string; statement?: string }>;
}

// ── Build a fresh empty thread ────────────────────────────────────────────────
function emptyThread(id: string, title: string): ChatThread {
  return { id, title, date: new Date().toLocaleDateString(), messages: [] };
}

// ── SQL collapsible (shown in agent activity) ─────────────────────────────────
function SQLBadge({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors hover:bg-black/5"
        style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
      >
        <span style={{ fontFamily: "monospace" }}>SQL</span>
        <ChevronDown size={11} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && (
        <pre
          className="mt-1 p-3 rounded-lg text-xs overflow-x-auto"
          style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)", maxHeight: 200 }}
        >
          {sql}
        </pre>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ThreadPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const threadId = params.threadId as string;

  // ── Thread state ────────────────────────────────────────────────────────────
  const [thread, setThread] = useState<ChatThread>(() =>
    emptyThread(threadId, "New conversation")
  );
  const [thinking, setThinking] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const bottomRef               = useRef<HTMLDivElement>(null);

  // ── Cortex conversation history (multi-turn) ────────────────────────────────
  const cortexHistory = useRef<CortexEntry[]>([]);

  // ── SQL map: msgId → sql string ─────────────────────────────────────────────
  const [sqlMap, setSqlMap] = useState<Record<string, string>>({});

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.messages, thinking]);

  // ── Fire initial query from home page (via sessionStorage) ──────────────────
  useEffect(() => {
    const key = `pendingQuery:${threadId}`;
    const pending = sessionStorage.getItem(key);
    if (pending) {
      sessionStorage.removeItem(key);
      handleSubmit(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = async (query: string) => {
    setError(null);

    // Add user message immediately
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: query,
    };
    setThread((prev) => ({
      ...prev,
      title: prev.messages.length === 0 ? query.slice(0, 60) : prev.title,
      messages: [...prev.messages, userMsg],
    }));
    setThinking(true);

    try {
      const res = await fetch("/api/cortex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          history: cortexHistory.current,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errBody.error ?? res.statusText);
      }

      const data = await res.json() as {
        content: string;
        sql?: string | null;
        sqlError?: string | null;
        tableData?: { headers: string[]; rows: (string | number)[][] } | null;
        chartData?: Array<{ name: string; value: number }> | null;
        suggestedFollowups?: string[];
        latency: string;
        analystMessage?: CortexEntry;
      };

      // Update Cortex history for next turn
      cortexHistory.current = [
        ...cortexHistory.current,
        { role: "user", content: [{ type: "text", text: query }] },
        ...(data.analystMessage ? [data.analystMessage] : []),
      ];

      const agentMsgId = `msg-${Date.now()}-a`;

      // Store SQL separately so we can show it in the collapsible
      if (data.sql) {
        setSqlMap((prev) => ({ ...prev, [agentMsgId]: data.sql! }));
      }

      const agentMsg: ChatMessage = {
        id: agentMsgId,
        role: "agent",
        content: data.sqlError
          ? `${data.content}\n\n⚠️ SQL execution error: ${data.sqlError}`
          : data.content,
        agentActivity: {
          masterAgent: "Master Agent",
          routedTo: "SRI Analytics Engine",
          latency: data.latency,
        },
        tableData: data.tableData ?? undefined,
        chartData: data.chartData ?? undefined,
        suggestedFollowups: data.suggestedFollowups ?? [],
      };

      setThread((prev) => ({
        ...prev,
        messages: [...prev.messages, agentMsg],
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-primary)" }}>
      {/* Thread header */}
      <div
        className="flex items-center justify-between px-6 py-3 shrink-0"
        style={{ background: "#ffffff", borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-sm font-medium truncate max-w-[60%]" style={{ color: "var(--text-primary)" }}>
          {thread.title || "New conversation"}
        </span>
        <button
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:opacity-90 shrink-0"
          style={{ background: "#FFA550", color: "#1C1A16" }}
        >
          <Pin size={13} />
          Save as Workflow
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-6">
        {thread.messages.length === 0 && !thinking && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center py-16">
            <Sparkles size={28} style={{ color: "var(--accent)", opacity: 0.5 }} />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Ask anything about your Snowflake data
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)", opacity: 0.6 }}>
              Powered by SRIntelligence™ Analytics
            </p>
          </div>
        )}

        {thread.messages.map((msg) => (
          <div key={msg.id}>
            <ChatMessageComponent
              message={msg}
              onFollowup={handleSubmit}
            />
            {/* Show SQL collapsible for agent messages */}
            {msg.role === "agent" && sqlMap[msg.id] && (
              <div className="ml-9 mt-1">
                <SQLBadge sql={sqlMap[msg.id]} />
              </div>
            )}
          </div>
        ))}

        {/* Thinking indicator */}
        {thinking && (
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: "linear-gradient(135deg, #2891DA, #FFA550)",
                boxShadow: "0 1px 4px rgba(40,145,218,0.25)",
              }}
            >
              <Sparkles size={13} color="white" />
            </div>
            <div className="flex gap-1.5 items-center py-2">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{
                    background: "var(--accent)",
                    opacity: 0.5,
                    animationDelay: `${i * 0.15}s`,
                  }}
                />
              ))}
            </div>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Analyzing…
            </span>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-xl"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <AlertCircle size={16} className="shrink-0" style={{ color: "#ef4444", marginTop: 1 }} />
            <div>
              <p className="text-xs font-semibold mb-0.5" style={{ color: "#ef4444" }}>
                Request failed
              </p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {error}
              </p>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 pb-5 pt-3 shrink-0">
        <ChatInput
          placeholder="Ask a follow-up…"
          onSubmit={handleSubmit}
          compact
          disabled={thinking}
        />
      </div>
    </div>
  );
}
