/**
 * Lightweight localStorage-backed chat thread store.
 * Safe to call on server (typeof window guard).
 */

import type { ChatMessage } from "./types";

// ---------------------------------------------------------------------------
// Thread summaries (left-rail list)
// ---------------------------------------------------------------------------

export interface ThreadSummary {
  id: string;
  title: string;
  /** "Apr 8" display string used for grouping in the rail */
  date: string;
  /** Unix ms — used for sort order */
  updatedAt: number;
}

const THREADS_KEY  = "sri:chat_threads";
const MAX_THREADS  = 200;

export function loadThreads(): ThreadSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    return raw ? (JSON.parse(raw) as ThreadSummary[]) : [];
  } catch {
    return [];
  }
}

export function saveThreads(threads: ThreadSummary[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads.slice(0, MAX_THREADS)));
  } catch { /* storage quota */ }
}

export function formatThreadDate(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Per-thread message persistence
// ---------------------------------------------------------------------------

export interface PersistedThread {
  messages: ChatMessage[];
  sqlMap: Record<string, string>;
  title: string;
}

/** Cap rows per message to avoid blowing localStorage quota (~5 MB). */
const MAX_ROWS_PER_MSG = 200;
/** Keep only the most recent N messages. */
const MAX_MESSAGES = 100;

function pruneMessage(msg: ChatMessage): ChatMessage {
  if (!msg.tableData) return msg;
  return {
    ...msg,
    tableData: {
      headers: msg.tableData.headers,
      rows: msg.tableData.rows.slice(0, MAX_ROWS_PER_MSG),
    },
  };
}

function threadKey(id: string) {
  return `sri:thread:${id}`;
}

export function saveThreadMessages(
  threadId: string,
  title: string,
  messages: ChatMessage[],
  sqlMap: Record<string, string>,
): void {
  if (typeof window === "undefined") return;
  try {
    const data: PersistedThread = {
      title,
      messages: messages.slice(-MAX_MESSAGES).map(pruneMessage),
      sqlMap,
    };
    localStorage.setItem(threadKey(threadId), JSON.stringify(data));
  } catch { /* storage quota */ }
}

export function loadThreadMessages(threadId: string): PersistedThread | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(threadKey(threadId));
    return raw ? (JSON.parse(raw) as PersistedThread) : null;
  } catch {
    return null;
  }
}
