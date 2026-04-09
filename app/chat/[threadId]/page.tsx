"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { useChatHistory } from "@/components/providers/ChatHistoryProvider";
import { saveThreadMessages, loadThreadMessages } from "@/lib/chat-history";
import { Pin, AlertCircle, ChevronDown, CheckCircle, Loader2 } from "lucide-react";
import ChatInput from "@/components/chat/ChatInput";
import ChatMessageComponent from "@/components/chat/ChatMessage";
import { ChatMessage, ChatThread } from "@/lib/types";
import type { DispatchEvent, FormattedResponse, AgentArtifact } from "@/src/types/agent";

// ── Build a fresh empty thread ────────────────────────────────────────────────
function emptyThread(id: string, title: string): ChatThread {
  return { id, title, date: new Date().toLocaleDateString(), messages: [] };
}

// ── Status pill shown while streaming ─────────────────────────────────────────
function StreamingStatus({ status }: { status: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: "linear-gradient(135deg, #2891DA 0%, #C8956A 100%)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
        }}
      >
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.5 1 L8.1 6.4 L13.5 8 L8.1 9.6 L6.5 15 L4.9 9.6 L0 8 L4.9 6.4 Z" fill="white" />
          <path d="M13.5 1.5 L14 3 L15.5 3.5 L14 4 L13.5 5.5 L13 4 L11.5 3.5 L13 3 Z" fill="white" />
        </svg>
      </div>
      <div className="flex items-center gap-2 py-2">
        <Loader2 size={13} className="animate-spin" style={{ color: "var(--accent)" }} />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{status}</span>
      </div>
    </div>
  );
}

// ── Collapsible SQL badge ──────────────────────────────────────────────────────
function SQLBadge({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    const finish = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(sql).then(finish).catch(() => {
        // Fallback for browsers that block clipboard in non-secure/iframe context
        try {
          const el = document.createElement("textarea");
          el.value = sql; el.style.position = "fixed"; el.style.opacity = "0";
          document.body.appendChild(el); el.select();
          document.execCommand("copy");
          document.body.removeChild(el);
          finish();
        } catch { /* silently ignore */ }
      });
    }
  };

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
        <div className="relative mt-1">
          <pre
            className="p-3 rounded-lg text-xs overflow-x-auto"
            style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)", border: "1px solid var(--border)", maxHeight: 220, fontFamily: "monospace" }}
          >
            {sql}
          </pre>
          <button
            onClick={copy}
            className="absolute top-2 right-2 text-xs px-2 py-0.5 rounded flex items-center gap-1"
            style={{ background: "var(--bg-secondary)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            {copied ? <><CheckCircle size={9} /> Copied</> : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Map an AgentArtifact to the legacy tableData / chartData fields ────────────
function artifactToTableData(artifact: AgentArtifact): { headers: string[]; rows: (string | number)[][] } | undefined {
  const d = artifact.data as Record<string, unknown> | undefined;
  if (!d) return undefined;

  // ANALYST artifact: { results: { headers, rows } }
  const results = d["results"] as { headers?: string[]; rows?: (string | number)[][] } | undefined;
  if (results?.headers && results?.rows) {
    return { headers: results.headers, rows: results.rows };
  }

  // Flat { headers, rows } shape
  if (Array.isArray(d["headers"]) && Array.isArray(d["rows"])) {
    return { headers: d["headers"] as string[], rows: d["rows"] as (string | number)[][] };
  }

  return undefined;
}

function artifactToChartData(artifact: AgentArtifact): Array<{ name: string; value: number }> | undefined {
  const d = artifact.data as Record<string, unknown> | undefined;
  if (!d) return undefined;

  // Forecast: { historical: [{date, actual}], forecast: [{date, forecast}] }
  const forecast = d["forecast"] as Array<{ date?: string; ds?: string; forecast?: number; yhat?: number }> | undefined;
  if (forecast?.length) {
    return forecast.slice(-12).map((r) => ({
      name: String(r.date ?? r.ds ?? ""),
      value: Number(r.forecast ?? r.yhat ?? 0),
    }));
  }

  return undefined;
}

// ── Build ChatMessage from FormattedResponse ───────────────────────────────────
function buildAgentMessage(id: string, resp: FormattedResponse): { msg: ChatMessage; sql: string | undefined } {
  const analystArtifact = resp.artifacts.find((a) => a.intent === "ANALYST");
  const firstArtifact   = resp.artifacts[0];

  const tableData  = analystArtifact ? artifactToTableData(analystArtifact) : (firstArtifact ? artifactToTableData(firstArtifact) : undefined);
  const chartData  = firstArtifact ? artifactToChartData(firstArtifact) : undefined;
  const sql        = analystArtifact?.sql ?? firstArtifact?.sql;
  const latencyS   = (resp.durationMs / 1000).toFixed(1);

  // Map intent to a human-readable label (no "Cortex" exposure)
  const intentLabel: Record<string, string> = {
    ANALYST:           "SRI Analytics Engine",
    FORECAST_PROPHET:  "SRI Forecast · Prophet",
    FORECAST_SARIMA:   "SRI Forecast · SARIMA",
    FORECAST_HW:       "SRI Forecast · Holt-Winters",
    FORECAST_XGBOOST:  "SRI Forecast · XGBoost",
    FORECAST_AUTO:     "SRI Forecast · Auto",
    FORECAST_COMPARE:  "SRI Forecast Comparison",
    CLUSTER_GMM:       "SRI Clustering · GMM",
    CLUSTER_KMEANS:    "SRI Clustering · K-Means",
    CLUSTER_AUTO:      "SRI Clustering · Auto",
    MTREE:             "SRI mTree™ Analytics",
    CAUSAL:            "SRI Causal Inference",
    PIPELINE:          "SRI Multi-Agent Pipeline",
    UNKNOWN:           "SRI Analytics Engine",
  };

  const msg: ChatMessage = {
    id,
    role: "agent",
    content: resp.narrative || "Analysis complete.",
    agentActivity: {
      masterAgent: "SRIntelligence™ Master Agent",
      routedTo: intentLabel[resp.intent] ?? "SRI Analytics Engine",
      latency: `${latencyS}s`,
    },
    tableData:          tableData ?? undefined,
    chartData:          chartData ?? undefined,
    suggestedFollowups: resp.suggestions ?? [],
  };

  return { msg, sql };
}

// ── SSE line parser ────────────────────────────────────────────────────────────
function parseSSELine(line: string): DispatchEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as DispatchEvent;
  } catch {
    return null;
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ThreadPage() {
  const params   = useParams();
  const threadId = params.threadId as string;

  const [thread,  setThread]  = useState<ChatThread>(() => emptyThread(threadId, "New conversation"));
  const [streaming, setStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState("Analyzing…");
  const [error,   setError]   = useState<string | null>(null);
  const [sqlMap,  setSqlMap]  = useState<Record<string, string>>({});
  const [savingWf, setSavingWf] = useState(false);
  const [savedWf,  setSavedWf]  = useState(false);

  const sessionIdRef    = useRef<string>(threadId);
  const bottomRef       = useRef<HTMLDivElement>(null);
  const abortRef        = useRef<AbortController | null>(null);
  const { upsertThread, threads } = useChatHistory();
  // Track whether we've persisted this thread yet (avoids calling upsertThread
  // inside a setState updater, which React disallows).
  const hasPersistedRef = useRef(false);
  const titleRef        = useRef("");

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.messages, streaming]);

  // Load persisted messages when navigating to an existing thread
  useEffect(() => {
    const saved = loadThreadMessages(threadId);
    if (saved && saved.messages.length > 0) {
      hasPersistedRef.current = true;
      titleRef.current = saved.title;
      setThread({ id: threadId, title: saved.title, date: new Date().toLocaleDateString(), messages: saved.messages });
      setSqlMap(saved.sqlMap ?? {});
    } else {
      // No saved messages — at least restore the title from the left-rail context
      const knownTitle = threads.find((t) => t.id === threadId)?.title;
      if (knownTitle) setThread((prev) => ({ ...prev, title: knownTitle }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (thread.messages.length === 0) return;
    saveThreadMessages(threadId, thread.title, thread.messages, sqlMap);
  }, [thread.messages, thread.title, sqlMap, threadId]);

  // Fire pending query from home page
  useEffect(() => {
    const key     = `pendingQuery:${threadId}`;
    const pending = sessionStorage.getItem(key);
    if (pending) {
      sessionStorage.removeItem(key);
      handleSubmit(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // ── Core submit handler: POST → SSE stream ─────────────────────────────────
  const handleSubmit = useCallback(async (query: string) => {
    setError(null);

    const userMsg: ChatMessage = {
      id:      `msg-${Date.now()}`,
      role:    "user",
      content: query,
    };

    // Persist to left-rail history on the first message (outside setState)
    if (!hasPersistedRef.current) {
      hasPersistedRef.current = true;
      titleRef.current = query.slice(0, 60);
      upsertThread(threadId, titleRef.current);
    }

    setThread((prev) => ({
      ...prev,
      title:    prev.messages.length === 0 ? query.slice(0, 60) : prev.title,
      messages: [...prev.messages, userMsg],
    }));

    setStreaming(true);
    setStreamStatus("Routing query…");

    const agentMsgId = `msg-${Date.now()}-a`;

    // Create a new abort controller for this request
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/agent/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        signal:  controller.signal,
        body: JSON.stringify({
          message:   query,
          sessionId: sessionIdRef.current,
        }),
      });

      // Capture session ID for multi-turn
      const returnedSession = res.headers.get("X-Session-Id");
      if (returnedSession) sessionIdRef.current = returnedSession;

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";

      // Intent label map for status messages
      const agentLabel: Record<string, string> = {
        ANALYST:           "SRI Analytics Engine",
        FORECAST_PROPHET:  "Forecast · Prophet",
        FORECAST_SARIMA:   "Forecast · SARIMA",
        FORECAST_HW:       "Forecast · Holt-Winters",
        FORECAST_XGBOOST:  "Forecast · XGBoost",
        FORECAST_AUTO:     "Forecast · Auto",
        FORECAST_COMPARE:  "Forecast Comparison",
        CLUSTER_GMM:       "Clustering · GMM",
        CLUSTER_KMEANS:    "Clustering · K-Means",
        CLUSTER_AUTO:      "Clustering · Auto",
        MTREE:             "mTree™",
        CAUSAL:            "Causal Inference",
        PIPELINE:          "Multi-Agent Pipeline",
      };

      let finalResponse: FormattedResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const event = parseSSELine(line.trim());
          if (!event) continue;

          switch (event.type) {
            case "ROUTING":
              setStreamStatus("Routing query…");
              break;
            case "AGENT_START":
              setStreamStatus(`Running ${agentLabel[event.intent ?? ""] ?? event.agentName ?? "agent"}…`);
              break;
            case "AGENT_COMPLETE":
              setStreamStatus("Synthesizing response…");
              break;
            case "SYNTHESIS_START":
              setStreamStatus("Generating narrative…");
              break;
            case "SYNTHESIS_COMPLETE": {
              // payload shape is { result: FormattedResponse }
              const p = event.payload as { result?: FormattedResponse } | FormattedResponse;
              finalResponse = ("result" in p && p.result) ? p.result : (p as FormattedResponse);
              break;
            }
            case "ERROR":
              throw new Error(event.error ?? "Unknown agent error");
          }
        }
      }

      if (!finalResponse) {
        throw new Error("No response received from the agent");
      }

      const { msg, sql } = buildAgentMessage(agentMsgId, finalResponse);

      if (sql) {
        setSqlMap((prev) => ({ ...prev, [agentMsgId]: sql }));
      }

      setThread((prev) => ({ ...prev, messages: [...prev.messages, msg] }));
      // Refresh updatedAt so thread bubbles to top of the rail (outside setState)
      upsertThread(threadId, titleRef.current);

    } catch (err: unknown) {
      // AbortError = user clicked Stop — clear state silently
      if (err instanceof Error && err.name === "AbortError") {
        setStreamStatus("Stopped.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }, []);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Save session as workflow ────────────────────────────────────────────────
  const handleSaveWorkflow = async () => {
    if (savingWf || savedWf) return;
    setSavingWf(true);
    try {
      const res = await fetch("/api/workflows/from-chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          name:      thread.title || "Untitled Workflow",
          description: `Saved from chat session ${threadId}`,
        }),
      });
      if (res.ok) setSavedWf(true);
    } catch {
      // non-critical
    } finally {
      setSavingWf(false);
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
          onClick={handleSaveWorkflow}
          disabled={savingWf || thread.messages.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:opacity-90 shrink-0 disabled:opacity-40"
          style={{ background: savedWf ? "var(--success, #22c55e)" : "#FFA550", color: "#1C1A16" }}
        >
          {savingWf ? (
            <><Loader2 size={12} className="animate-spin" />Saving…</>
          ) : savedWf ? (
            <><CheckCircle size={12} />Saved!</>
          ) : (
            <><Pin size={12} />Save as Workflow</>
          )}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-6">
        {thread.messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center py-16">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #2891DA 0%, #C8956A 100%)", opacity: 0.5 }}
            >
              <svg width="28" height="28" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.5 1 L8.1 6.4 L13.5 8 L8.1 9.6 L6.5 15 L4.9 9.6 L0 8 L4.9 6.4 Z" fill="white" />
                <path d="M13.5 1.5 L14 3 L15.5 3.5 L14 4 L13.5 5.5 L13 4 L11.5 3.5 L13 3 Z" fill="white" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Ask anything about your Snowflake data
            </p>
          </div>
        )}

        {thread.messages.map((msg) => (
          <div key={msg.id}>
            <ChatMessageComponent message={msg} onFollowup={handleSubmit} />
            {msg.role === "agent" && sqlMap[msg.id] && (
              <div className="ml-9 mt-1">
                <SQLBadge sql={sqlMap[msg.id]} />
              </div>
            )}
          </div>
        ))}

        {/* Streaming status */}
        {streaming && <StreamingStatus status={streamStatus} />}

        {/* Error banner */}
        {error && (
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-xl"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <AlertCircle size={16} className="shrink-0" style={{ color: "#ef4444", marginTop: 1 }} />
            <div>
              <p className="text-xs font-semibold mb-0.5" style={{ color: "#ef4444" }}>Request failed</p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{error}</p>
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
          onAbort={handleAbort}
          history={thread.messages
            .filter((m) => m.role === "user")
            .map((m) => m.content)
            .reverse()}
          compact
          disabled={streaming}
        />
      </div>
    </div>
  );
}
