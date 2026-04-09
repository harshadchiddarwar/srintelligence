"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  type ThreadSummary,
  loadThreads,
  saveThreads,
  formatThreadDate,
} from "@/lib/chat-history";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface ChatHistoryContextType {
  threads: ThreadSummary[];
  /** Create or update a thread entry (called when first message is sent) */
  upsertThread: (id: string, title: string) => void;
  /** Remove a thread from history */
  deleteThread: (id: string) => void;
  /** Rename a thread in-place */
  renameThread: (id: string, title: string) => void;
}

const ChatHistoryContext = createContext<ChatHistoryContextType>({
  threads: [],
  upsertThread: () => {},
  deleteThread: () => {},
  renameThread: () => {},
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ChatHistoryProvider({ children }: { children: ReactNode }) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);

  // Hydrate from localStorage once on mount (client-only)
  useEffect(() => {
    setThreads(loadThreads());
  }, []);

  const upsertThread = useCallback((id: string, title: string) => {
    setThreads((prev) => {
      const exists = prev.some((t) => t.id === id);
      const next: ThreadSummary[] = exists
        ? prev.map((t) =>
            t.id === id ? { ...t, title, updatedAt: Date.now() } : t
          )
        : [
            { id, title, date: formatThreadDate(), updatedAt: Date.now() },
            ...prev,
          ];
      // Keep newest first
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      saveThreads(next);
      return next;
    });
  }, []);

  const deleteThread = useCallback((id: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveThreads(next);
      return next;
    });
  }, []);

  const renameThread = useCallback((id: string, title: string) => {
    setThreads((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, title } : t));
      saveThreads(next);
      return next;
    });
  }, []);

  return (
    <ChatHistoryContext.Provider
      value={{ threads, upsertThread, deleteThread, renameThread }}
    >
      {children}
    </ChatHistoryContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useChatHistory() {
  return useContext(ChatHistoryContext);
}
