"use client";

import { ChatMessage as ChatMessageType } from "@/lib/types";
import AgentActivityBar from "./AgentActivityBar";
import DataTable from "./DataTable";
import InlineChart from "./InlineChart";

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
        {/* Large sparkle — 4-arm star, dominates the circle */}
        <path
          d="M6.5 1 L8.1 6.4 L13.5 8 L8.1 9.6 L6.5 15 L4.9 9.6 L0 8 L4.9 6.4 Z"
          fill="white"
        />
        {/* Small sparkle — upper-right, clearly secondary */}
        <path
          d="M13.5 1.5 L14 3 L15.5 3.5 L14 4 L13.5 5.5 L13 4 L11.5 3.5 L13 3 Z"
          fill="white"
        />
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
        // Bullet list lines
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
        // Empty line → small spacer
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
        <div
          className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tr-md text-sm leading-relaxed"
          style={{
            background: "var(--accent-dim)",
            color: "var(--text-primary)",
            border: "1px solid rgba(40,145,218,0.12)",
          }}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {message.agentActivity && (
        <AgentActivityBar activity={message.agentActivity} />
      )}

      <div className="flex items-start gap-2.5">
        {/* Agent avatar */}
        <AIAvatar />

        <div className="flex flex-col gap-3 flex-1 min-w-0">
          {/* Narrative text with markdown rendering */}
          {message.content && (
            <InlineMarkdown text={message.content} />
          )}

          {message.tableData && <DataTable data={message.tableData} />}
          {message.chartData && <InlineChart data={message.chartData} />}

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
        </div>
      </div>
    </div>
  );
}
