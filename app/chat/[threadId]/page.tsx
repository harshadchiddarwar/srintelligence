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
import { parseForecastNarrative } from "@/src/components/artifacts/ForecastArtifact";
import { fromV2ClusterData, fromResultTable, parseClusteringNarrative } from "@/src/components/artifacts/SegmentationArtifact";

// ── Build a fresh empty thread ────────────────────────────────────────────────
function emptyThread(id: string, title: string): ChatThread {
  return { id, title, date: new Date().toLocaleDateString(), messages: [] };
}

// ── Status pill shown while streaming ─────────────────────────────────────────
function StreamingStatus({ status }: { status: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const fmt = elapsed >= 60
    ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
    : `${elapsed}s`;

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
        <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)", opacity: 0.6 }}>{fmt}</span>
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

// ── Normalise a row value to string | number ──────────────────────────────────
function normaliseCell(v: unknown): string | number {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  const str = String(v).trim();
  // Try to coerce numeric strings (but not date strings like "2024-01")
  if (str !== '' && !isNaN(Number(str)) && !/[-/]/.test(str)) return Number(str);
  return str;
}

// ── Build a { headers, rows } table from an array of objects ─────────────────
function rowsFromObjectArray(arr: Record<string, unknown>[]): { headers: string[]; rows: (string | number)[][] } {
  const headers = Object.keys(arr[0] ?? {});
  const rows = arr.map((row) => headers.map((h) => normaliseCell(row[h])));
  return { headers, rows };
}

// ── Map an AgentArtifact to the legacy tableData / chartData fields ────────────
function artifactToTableData(artifact: AgentArtifact): { headers: string[]; rows: (string | number)[][] } | undefined {
  const data = artifact.data;
  if (data === null || data === undefined) return undefined;

  // ── Shape 1: direct array of objects [{ col: val }, ...] ─────────────────
  // Covers named-agent responses that return rows directly, or the fallback
  // where analyst-agent.ts stores analystResponse.data as-is.
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    return rowsFromObjectArray(data as Record<string, unknown>[]);
  }

  const d = data as Record<string, unknown>;

  // ── Shape 2: { results: { headers, rows } }  (primary ANALYST shape) ──────
  const results = d["results"] as
    | { headers?: string[]; rows?: (string | number)[][] }
    | Record<string, unknown>[]
    | undefined;

  if (results && typeof results === 'object' && !Array.isArray(results)) {
    const r = results as { headers?: string[]; rows?: (string | number)[][] };
    if (Array.isArray(r.headers) && Array.isArray(r.rows)) {
      return { headers: r.headers, rows: r.rows };
    }
  }

  // ── Shape 3: { results: [{ col: val }, ...] } — array in results key ──────
  if (Array.isArray(results) && results.length > 0 && typeof results[0] === 'object') {
    return rowsFromObjectArray(results as Record<string, unknown>[]);
  }

  // ── Shape 4: flat { headers, rows } ──────────────────────────────────────
  if (Array.isArray(d["headers"]) && Array.isArray(d["rows"])) {
    return { headers: d["headers"] as string[], rows: d["rows"] as (string | number)[][] };
  }

  // ── Shape 5: { data: [{ col: val }, ...] } ───────────────────────────────
  const dataArr = d["data"];
  if (Array.isArray(dataArr) && dataArr.length > 0 && typeof dataArr[0] === 'object' && dataArr[0] !== null) {
    return rowsFromObjectArray(dataArr as Record<string, unknown>[]);
  }

  // ── Shape 6: { rows: [{ col: val }, ...] } ───────────────────────────────
  const rowsArr = d["rows"];
  if (Array.isArray(rowsArr) && rowsArr.length > 0 && typeof rowsArr[0] === 'object' && rowsArr[0] !== null) {
    return rowsFromObjectArray(rowsArr as Record<string, unknown>[]);
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

  // ANALYST: { results: { headers: string[], rows: (string|number)[][] } }
  const results = d["results"] as { headers?: string[]; rows?: (string | number)[][] } | undefined;
  if (results && Array.isArray(results.headers) && Array.isArray(results.rows) && results.rows.length > 0) {
    const headers = results.headers;
    const rows = results.rows;

    // Suppress chart for entity/person lists (physicians, patients, etc.) — these
    // produce meaningless high-cardinality bar charts rather than aggregated insights.
    const firstHeader = headers[0] ?? '';
    const isEntityList = /first.?name|last.?name|physician|patient|doctor|hcp|npi|prescriber|provider/i.test(firstHeader);
    if (isEntityList) return undefined;

    // Also suppress when many rows exist and there's no temporal aggregation dimension.
    const hasTemporalCol = headers.some((h) =>
      /date|month|week|year|quarter|period|ds|time/i.test(h)
    );
    if (rows.length > 30 && !hasTemporalCol) return undefined;

    // Find temporal column (date/month/period/etc.)
    const temporalIdx = headers.findIndex((h) =>
      /date|month|week|year|quarter|period|ds|time/i.test(h),
    );

    // Find first genuinely numeric column (skip formatted strings like *_FORMATTED)
    const numericIdx = headers.findIndex((h, i) => {
      if (i === temporalIdx) return false;
      if (/_formatted$/i.test(h)) return false;
      const val = rows[0]?.[i];
      if (typeof val === 'number') return true;
      if (typeof val === 'string' && val !== '') return !isNaN(Number(val.replace(/,/g, '')));
      return false;
    });

    if (numericIdx >= 0) {
      const nameIdx = temporalIdx >= 0 ? temporalIdx : (numericIdx === 0 ? 1 : 0);
      // Sort chronologically by temporal column (handles MM/DD/YY format)
      const parseDateKey = (v: string | number): number => {
        const s = String(v ?? '');
        const [mm, dd, yy] = s.split('/');
        return yy && mm && dd ? parseInt(`20${yy}${mm}${dd}`, 10) : 0;
      };
      const sorted = temporalIdx >= 0
        ? [...rows].sort((a, b) => parseDateKey(a[temporalIdx]) - parseDateKey(b[temporalIdx]))
        : rows;
      return sorted.map((row) => ({
        name: String(row[nameIdx] ?? ''),
        value: typeof row[numericIdx] === 'number'
          ? (row[numericIdx] as number)
          : Number(String(row[numericIdx] ?? '0').replace(/,/g, '')),
      }));
    }
  }

  return undefined;
}

// ── Build ChatMessage from FormattedResponse ───────────────────────────────────
function buildAgentMessage(id: string, resp: FormattedResponse): { msg: ChatMessage; sql: string | undefined } {
  const analystArtifact = resp.artifacts.find((a) => a.intent === "ANALYST");
  const firstArtifact   = resp.artifacts[0];

  // Detect forecast intents — use structured rendering instead of raw markdown
  const isForecast = /^FORECAST_/.test(resp.intent);
  // Detect clustering intents — use SegmentationArtifact instead of plain markdown
  const isCluster = /^CLUSTER/.test(resp.intent);
  // Detect mTree intent — MTreeArtifact handles all rendering; suppress raw narrative
  const isMTree = resp.intent === 'MTREE';
  // Detect causal intent — CausalNarrativeReport handles all rendering; suppress raw narrative
  const isCausal = resp.intent === 'CAUSAL';

  let tableData  = (!isForecast && !isCluster && !isCausal && analystArtifact) ? artifactToTableData(analystArtifact)
                 : (!isForecast && !isCluster && !isCausal && firstArtifact)   ? artifactToTableData(firstArtifact)
                 : undefined;
  const chartData  = (!isForecast && !isCluster && !isCausal && firstArtifact) ? artifactToChartData(firstArtifact) : undefined;

  // Sort tableData rows by temporal column oldest → newest (MM/DD/YY format)
  if (tableData) {
    const tIdx = tableData.headers.findIndex(h => /date|month|week|year|quarter|period|ds|time/i.test(h));
    if (tIdx >= 0) {
      const parseDateKey = (v: string | number): number => {
        const s = String(v ?? '');
        const [mm, dd, yy] = s.split('/');
        return yy && mm && dd ? parseInt(`20${yy}${mm}${dd}`, 10) : 0;
      };
      tableData = { ...tableData, rows: [...tableData.rows].sort((a, b) => parseDateKey(a[tIdx]) - parseDateKey(b[tIdx])) };
    }
  }

  // For cluster intents: build structured SegmentationData.
  let segmentData: Record<string, unknown> | undefined;
  if (isCluster) {
    const artifactData = firstArtifact?.data as Record<string, unknown> | null | undefined;
    if (artifactData && typeof artifactData === 'object' && Object.keys(artifactData).length > 0) {
      // 1. Snowflake result table: { results: { headers: [...CLUSTER_ID, PC1, PC2, MODEL_METADATA...], rows } }
      const fromTable = fromResultTable(artifactData);
      if (fromTable) {
        // Enrich with narrative descriptions
        const narData = parseClusteringNarrative(resp.narrative ?? '');
        for (const seg of fromTable.segments) {
          const narSeg = narData.segments.find((ns) => ns.id === seg.id);
          if (narSeg) {
            if (!seg.description && narSeg.description) seg.description = narSeg.description;
            if (!seg.topDriver   && narSeg.topDriver)   seg.topDriver   = narSeg.topDriver;
          }
        }
        if (!fromTable.interpretation && narData.interpretation) fromTable.interpretation = narData.interpretation;
        if (!fromTable.caveats?.length && narData.caveats?.length) fromTable.caveats = narData.caveats;
        segmentData = fromTable as unknown as Record<string, unknown>;

      // 2. v2 structured: { segments: [...] }
      } else if (Array.isArray((artifactData)['segments'])) {
        segmentData = fromV2ClusterData(artifactData) as unknown as Record<string, unknown>;

      // 3. Pass through as-is (SegmentationArtifact will re-parse)
      } else {
        segmentData = artifactData;
      }
    } else {
      // v3 named agent: parse narrative text
      segmentData = parseClusteringNarrative(resp.narrative ?? '') as unknown as Record<string, unknown>;
    }
  }

  // For forecast intents: parse the narrative into structured ForecastData.
  // artifact.data may already be populated (v2 agents); fall back to parsing
  // the narrative text (v3 Snowflake named agent returns markdown).
  let forecastData: Record<string, unknown> | undefined;
  if (isForecast) {
    const artifactData = firstArtifact?.data as Record<string, unknown> | null | undefined;
    console.log('[FORECAST_CLIENT] intent=', resp.intent);
    console.log('[FORECAST_CLIENT] artifact.data=', artifactData);
    console.log('[FORECAST_CLIENT] narrative length=', resp.narrative?.length ?? 0);
    console.log('[FORECAST_CLIENT] narrative full=', resp.narrative);
    if (artifactData && Object.keys(artifactData).length > 0) {
      forecastData = artifactData;
      console.log('[FORECAST_CLIENT] using artifact.data directly, keys=', Object.keys(artifactData));
    } else {
      const parsed = parseForecastNarrative(resp.narrative ?? '') as Record<string, unknown>;
      const hasForecastRows  = Array.isArray(parsed['forecast'])  && (parsed['forecast']  as unknown[]).length > 0;
      const hasValidationRows = Array.isArray(parsed['validation']) && (parsed['validation'] as unknown[]).length > 0;
      // Multi-cluster results return { clusters: [...] } with no top-level forecast/validation arrays.
      const hasClusterData   = Array.isArray(parsed['clusters'])  && (parsed['clusters']  as unknown[]).length >= 2;
      // Only use parsed data if it contains structured data (forecast rows, validation rows,
      // or per-cluster sections). If nothing was parseable, fall through to markdown rendering.
      forecastData = (hasForecastRows || hasValidationRows || hasClusterData) ? parsed : undefined;
      console.log('[FORECAST_CLIENT] parsed from narrative:', {
        hasForecast:    hasForecastRows,
        forecastLen:    hasForecastRows ? (parsed['forecast'] as unknown[]).length : 0,
        hasValidation:  hasValidationRows,
        validationLen:  hasValidationRows ? (parsed['validation'] as unknown[]).length : 0,
        hasClusters:    hasClusterData,
        clusterCount:   hasClusterData ? (parsed['clusters'] as unknown[]).length : 0,
        metrics:        parsed['metrics'],
        usedParsed:     forecastData != null,
      });
    }
  }

  const sql        = analystArtifact?.sql ?? firstArtifact?.sql;
  const latencyMs  = resp.durationMs;
  const latencyMins = Math.floor(latencyMs / 60_000);
  const latencySecs = Math.round((latencyMs % 60_000) / 1000);
  const latencyLabel = latencyMins > 0
    ? `${latencyMins}m ${latencySecs}s`
    : `${latencySecs}s`;

  // Map intent to a human-readable label (no "Cortex" exposure)
  const intentLabel: Record<string, string> = {
    ANALYST:                "SRI Analytics Engine",
    FORECAST_PROPHET:       "SRI Forecast · Prophet",
    FORECAST_SARIMA:        "SRI Forecast · SARIMA",
    FORECAST_HW:            "SRI Forecast · Holt-Winters",
    FORECAST_XGBOOST:       "SRI Forecast · XGBoost",
    FORECAST_AUTO:          "SRI Forecast · Auto",
    FORECAST_COMPARE:       "SRI Forecast Comparison",
    CLUSTER:                "SRI Clustering",
    CLUSTER_GM:             "SRI Clustering · GMM",
    CLUSTER_GMM:            "SRI Clustering · GMM",
    CLUSTER_KMEANS:         "SRI Clustering · K-Means",
    CLUSTER_KMEDOIDS:       "SRI Clustering · K-Medoids",
    CLUSTER_DBSCAN:         "SRI Clustering · DBSCAN",
    CLUSTER_HIERARCHICAL:   "SRI Clustering · Hierarchical",
    CLUSTER_COMPARE:        "SRI Clustering Comparison",
    MTREE:                  "SRI Meta Tree Analytics",
    CAUSAL:                 "SRI Causal Inference",
    PIPELINE:               "SRI Multi-Agent Pipeline",
    UNKNOWN:                "SRI Analytics Engine",
  };

  const msg: ChatMessage = {
    id,
    role: "agent",
    // Suppress raw narrative only when the artifact component has structured data to render.
    // If forecast parsing found no rows (text-only response), show the narrative as markdown.
    content: (isCluster || isMTree || isCausal || (isForecast && forecastData != null)) ? "" : (resp.narrative || "Analysis complete."),
    agentActivity: {
      masterAgent: "SRIntelligence™ Master Agent",
      routedTo: intentLabel[resp.intent] ?? "SRI Analytics Engine",
      latency: latencyLabel,
    },
    tableData:          tableData ?? undefined,
    chartData:          chartData ?? undefined,
    forecastData:       forecastData,
    segmentData:        segmentData,
    // Preserve raw narrative text so SegmentationArtifact can extract z-scores client-side
    clusterNarrative:   isCluster ? (resp.narrative ?? undefined) : undefined,
    mTreeNarrative:     isMTree   ? (resp.narrative ?? undefined) : undefined,
    causalNarrative:    isCausal  ? (resp.narrative ?? undefined) : undefined,
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
      // ── Cohort handoff: find last ANALYST result and pass SQL + columns ──────
      // This ensures clustering / forecasting / causal agents scope to the same
      // cohort even if the server restarted and lost in-memory intermediateResults.
      // We require tableData.headers to be non-empty to distinguish analyst messages
      // from cluster/forecast messages (which have segmentData/forecastData instead).
      const lastAnalystMsg = [...thread.messages]
        .reverse()
        .find(
          (m) =>
            m.role === "agent" &&
            sqlMap[m.id] &&
            Array.isArray(m.tableData?.headers) &&
            (m.tableData?.headers?.length ?? 0) > 0,
        );
      const priorAnalystSQL     = lastAnalystMsg ? sqlMap[lastAnalystMsg.id] : undefined;
      const priorAnalystColumns = lastAnalystMsg?.tableData?.headers;

      const res = await fetch("/api/agent/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        signal:  controller.signal,
        body: JSON.stringify({
          message:   query,
          sessionId: sessionIdRef.current,
          ...(priorAnalystSQL     ? { priorAnalystSQL }     : {}),
          ...(priorAnalystColumns ? { priorAnalystColumns } : {}),
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
        MTREE:             "Meta Tree",
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
            case "AGENT_ERROR":
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
            <AlertCircle size={16} className="shrink-0" style={{ color: "#111111", marginTop: 1 }} />
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
