"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import { Pin, Sparkles } from "lucide-react";
import ChatInput from "@/components/chat/ChatInput";
import ChatMessageComponent from "@/components/chat/ChatMessage";
import { chatThreads } from "@/lib/mock-data";
import { ChatMessage, ChatThread } from "@/lib/types";

export default function ThreadPage() {
  const params = useParams();
  const threadId = params.threadId as string;

  const baseThread = chatThreads.find((t) => t.id === threadId) ?? chatThreads[0];
  const [thread, setThread] = useState<ChatThread>(baseThread);
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.messages, thinking]);

  const handleSubmit = (query: string) => {
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: query,
    };
    setThread((prev) => ({ ...prev, messages: [...prev.messages, userMsg] }));
    setThinking(true);

    setTimeout(() => {
      const agentMsg: ChatMessage = {
        id: `msg-${Date.now()}-a`,
        role: "agent",
        content:
          "I've analyzed your question using the available data. Here's what I found based on the current semantic model and Snowflake data:",
        agentActivity: {
          masterAgent: "Master Agent",
          routedTo: "Cortex Analyst",
          latency: "1.1s",
        },
        suggestedFollowups: [
          "Show this trend over the last 13 weeks",
          "Break this down by payer type",
          "Compare to prior year",
        ],
      };
      setThread((prev) => ({ ...prev, messages: [...prev.messages, agentMsg] }));
      setThinking(false);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg-primary)" }}>
      {/* Thread header */}
      <div
        className="flex items-center justify-between px-6 py-3 shrink-0"
        style={{ background: "#ffffff" }}
      >
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          Thread: {thread.title}
        </span>
        <button
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:opacity-90"
          style={{ background: "#FFA550", color: "#1C1A16" }}
        >
          <Pin size={13} />
          Save as Workflow
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-6">
        {thread.messages.map((msg) => (
          <ChatMessageComponent
            key={msg.id}
            message={msg}
            onFollowup={handleSubmit}
          />
        ))}

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
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 pb-5 pt-3 shrink-0">
        <ChatInput
          placeholder="Ask a follow-up..."
          onSubmit={handleSubmit}
          compact
        />
      </div>
    </div>
  );
}
