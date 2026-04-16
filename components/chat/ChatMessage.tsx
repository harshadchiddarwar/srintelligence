"use client";

import { useState, useRef, useEffect } from "react";
import { Copy, Check, RotateCcw, Pencil, Send, X } from "lucide-react";
import { ChatMessage as ChatMessageType } from "@/lib/types";
import AgentActivityBar from "./AgentActivityBar";
import DataTable from "./DataTable";
import InlineChart from "./InlineChart";
import FeedbackButtons from "@/src/components/chat/FeedbackButtons";
import ForecastArtifact from "@/src/components/artifacts/ForecastArtifact";
import SegmentationArtifact from "@/src/components/artifacts/SegmentationArtifact";
import MTreeArtifact from "@/src/components/artifacts/MTreeArtifact";
import type { AgentArtifact } from "@/src/types/agent";

// ---------------------------------------------------------------------------
// AI Avatar — gradient circle, two white sparkles (large + small)
// ---------------------------------------------------------------------------

function AIAvatar() {
  return (
    <div
      className="w-7 h-7 rounded-full shrink-0 mt-0.5 flex items-center justify-center"
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
  );
}

// ---------------------------------------------------------------------------
// Inline markdown renderer — handles **bold**, _italic_, bullet lists
// ---------------------------------------------------------------------------

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("_") && part.endsWith("_")) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function InlineMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((line, li) => {
        if (line.trimStart().startsWith("- ") || line.trimStart().startsWith("* ")) {
          return (
            <div key={li} className="flex items-start gap-2">
              <span className="mt-1 shrink-0" style={{ color: "var(--text-muted)" }}>•</span>
              <span className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
                {renderInline(line.replace(/^[\s\-*]+/, ""))}
              </span>
            </div>
          );
        }
        if (line.trim() === "") return <div key={li} className="h-1" />;
        return (
          <p key={li} className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User bubble with hover actions (edit / copy / rerun)
// ---------------------------------------------------------------------------

function UserBubble({
  message,
  onSubmit,
}: {
  message: ChatMessageType;
  onSubmit?: (text: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus + resize textarea when edit mode opens
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).catch(() => {
      // Fallback for non-secure contexts
      try {
        const el = document.createElement("textarea");
        el.value = message.content;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      } catch { /* ignore */ }
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRerun = () => {
    onSubmit?.(message.content);
  };

  const handleEditSubmit = () => {
    const trimmed = editText.trim();
    if (trimmed) {
      onSubmit?.(trimmed);
      setEditing(false);
    }
  };

  const handleEditCancel = () => {
    setEditText(message.content);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    }
    if (e.key === "Escape") {
      handleEditCancel();
    }
  };

  return (
    <div
      className="flex flex-col items-end gap-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!editing) setHovered(false); }}
    >
      {/* Bubble — normal or edit mode */}
      {editing ? (
        <div
          className="w-full max-w-[45%] rounded-2xl rounded-tr-md overflow-hidden"
          style={{
            border: "1.5px solid var(--accent)",
            background: "var(--accent-dim)",
            boxShadow: "0 0 0 3px rgba(40,145,218,0.08)",
          }}
        >
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={Math.min(8, (editText.match(/\n/g)?.length ?? 0) + 2)}
            className="w-full bg-transparent text-sm leading-relaxed resize-none outline-none px-4 pt-3 pb-2"
            style={{ color: "var(--text-primary)" }}
          />
          <div
            className="flex items-center justify-end gap-2 px-3 pb-2.5"
            style={{ borderTop: "1px solid rgba(40,145,218,0.12)" }}
          >
            <button
              onClick={handleEditCancel}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:bg-black/8"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={11} />
              Cancel
            </button>
            <button
              onClick={handleEditSubmit}
              disabled={!editText.trim()}
              className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition-colors hover:opacity-90 disabled:opacity-40"
              style={{ background: "var(--accent)", color: "#ffffff" }}
            >
              <Send size={11} />
              Send
            </button>
          </div>
        </div>
      ) : (
        <div
          className="max-w-[45%] px-4 py-2.5 rounded-2xl rounded-tr-md text-sm leading-relaxed"
          style={{
            background: "var(--accent-dim)",
            color: "var(--text-primary)",
            border: "1px solid rgba(40,145,218,0.12)",
          }}
        >
          {message.content}
        </div>
      )}

      {/* Hover action toolbar — fades in below the bubble */}
      {!editing && (
        <div
          className="flex items-center gap-0.5 transition-all duration-150"
          style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none" }}
        >
          {/* Edit */}
          <button
            onClick={() => { setEditing(true); setHovered(false); }}
            title="Edit"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors hover:bg-black/6"
            style={{ color: "var(--text-muted)" }}
          >
            <Pencil size={11} />
            <span>Edit</span>
          </button>

          <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>

          {/* Copy */}
          <button
            onClick={handleCopy}
            title="Copy"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors hover:bg-black/6"
            style={{ color: copied ? "var(--success, #22c55e)" : "var(--text-muted)" }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>

          <span style={{ color: "var(--border)", userSelect: "none" }}>·</span>

          {/* Rerun */}
          <button
            onClick={handleRerun}
            title="Rerun"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors hover:bg-black/6"
            style={{ color: "var(--text-muted)" }}
          >
            <RotateCcw size={11} />
            <span>Rerun</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatMessage
// ---------------------------------------------------------------------------

interface ChatMessageProps {
  message: ChatMessageType;
  onFollowup?: (text: string) => void;
}

export default function ChatMessageComponent({ message, onFollowup }: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <UserBubble message={message} onSubmit={onFollowup} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {message.agentActivity && (
        <AgentActivityBar activity={message.agentActivity} />
      )}

      <div className="flex items-start gap-2.5">
        <AIAvatar />

        <div className="flex flex-col gap-3 flex-1 min-w-0">
          {message.mTreeNarrative ? (
            <MTreeArtifact
              artifact={{
                id: message.id,
                agentName: message.agentActivity?.routedTo ?? 'mtree',
                intent: 'MTREE',
                data: null,
                narrative: message.mTreeNarrative,
                createdAt: Date.now(),
                lineageId: message.id,
                cacheStatus: 'miss',
              } as AgentArtifact}
            />
          ) : message.forecastData ? (
            <ForecastArtifact
              artifact={{
                id: message.id,
                agentName: message.agentActivity?.routedTo ?? 'forecast',
                intent: 'FORECAST_AUTO',
                data: message.forecastData,
                narrative: '',
                createdAt: Date.now(),
                lineageId: message.id,
                cacheStatus: 'miss',
              } as AgentArtifact}
            />
          ) : message.segmentData ? (
            <SegmentationArtifact
              artifact={{
                id: message.id,
                agentName: message.agentActivity?.routedTo ?? 'clustering',
                intent: 'CLUSTER_GM',
                data: message.segmentData,
                narrative: message.clusterNarrative ?? message.content ?? '',
                createdAt: Date.now(),
                lineageId: message.id,
                cacheStatus: 'miss',
              } as AgentArtifact}
            />
          ) : (
            <>
              {message.content && (
                <InlineMarkdown text={message.content} />
              )}
              {message.chartData && <InlineChart data={message.chartData} />}
              {message.tableData && <DataTable data={message.tableData} />}
            </>
          )}

          {message.suggestedFollowups && message.suggestedFollowups.length > 0 && (
            <div>
              <div
                className="px-1 py-1.5 flex items-center gap-2 text-xs font-medium mb-1.5"
                style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}
              >
                Suggested Follow-ups
              </div>
              <div className="flex flex-col gap-1">
                {message.suggestedFollowups.map((followup, i) => (
                  <button
                    key={i}
                    onClick={() => onFollowup?.(followup)}
                    className="text-left px-4 py-2.5 rounded-lg text-sm transition-colors hover:opacity-80"
                    style={{
                      color: "var(--text-primary)",
                      background: "var(--bg-secondary)",
                    }}
                  >
                    {followup}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Feedback thumbs — only shown on completed agent messages */}
          <FeedbackButtons
            executionId={message.id}
            agentName={message.agentActivity?.routedTo ?? "SRI_ANALYST_AGENT"}
          />
        </div>
      </div>
    </div>
  );
}
