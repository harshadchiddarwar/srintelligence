"use client";

import { ChatMessage as ChatMessageType } from "@/lib/types";
import AgentActivityBar from "./AgentActivityBar";
import DataTable from "./DataTable";
import InlineChart from "./InlineChart";

// Gradient sparkle avatar — white circle, one large + one small sparkle filled with brand gradient
function AIAvatar() {
  return (
    <div
      className="w-7 h-7 rounded-full shrink-0 mt-0.5 flex items-center justify-center"
      style={{ background: "#ffffff", border: "1.5px solid #E0E0E0", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
    >
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sg2" x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2891DA" />
            <stop offset="100%" stopColor="#FFA550" />
          </linearGradient>
        </defs>
        {/* Large sparkle — 4-arm star, dominant, centered-left */}
        <path
          d="M6.5 1.5 L7.6 5.4 L11.5 6.5 L7.6 7.6 L6.5 11.5 L5.4 7.6 L1.5 6.5 L5.4 5.4Z"
          fill="url(#sg2)"
        />
        {/* Small sparkle — compact 4-arm star, upper-right corner */}
        <path
          d="M13 4.5 L13.55 6.2 L15 6.5 L13.55 6.8 L13 8.5 L12.45 6.8 L11 6.5 L12.45 6.2Z"
          fill="url(#sg2)"
        />
      </svg>
    </div>
  );
}

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
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
            {message.content}
          </p>

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
