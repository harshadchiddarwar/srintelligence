/**
 * In-memory session store for SRIntelligence.
 *
 * Properties:
 *  - 30-minute TTL per session
 *  - Maximum 50 messages retained per session (enforced by callers via context shape)
 *  - Singleton pattern
 *  - Lazy cleanup on get/set — no background timer required
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 60 * 1_000; // 30 minutes
const MAX_MESSAGES_PER_SESSION = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The context bag stored for each session.
 *
 * We use Record<string, unknown> to keep this module free of circular
 * dependencies on agent types. Consumers cast to their concrete types.
 *
 * The 'messages' key, if present, is expected to be an array and is
 * automatically trimmed to MAX_MESSAGES_PER_SESSION on write.
 */
export interface StoredSession {
  context: Record<string, unknown>;
  lastAccessed: number;
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export class SessionStore {
  private static instance: SessionStore;
  private readonly sessions = new Map<string, StoredSession>();

  private constructor() {}

  static getInstance(): SessionStore {
    if (!SessionStore.instance) {
      SessionStore.instance = new SessionStore();
    }
    return SessionStore.instance;
  }

  // -------------------------------------------------------------------------
  // Key helpers
  // -------------------------------------------------------------------------

  private static key(userId: string, sessionId: string): string {
    return `${userId}:${sessionId}`;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Retrieve a session.
   *
   * Returns null if the session does not exist or has expired.
   * Triggers a cleanup sweep on every call.
   */
  get(userId: string, sessionId: string): StoredSession | null {
    this.cleanup();

    const k = SessionStore.key(userId, sessionId);
    const entry = this.sessions.get(k);
    if (!entry) return null;

    if (entry.lastAccessed + SESSION_TTL_MS < Date.now()) {
      this.sessions.delete(k);
      return null;
    }

    // Refresh last-accessed on read
    entry.lastAccessed = Date.now();
    return entry;
  }

  /**
   * Create or update a session.
   *
   * If the context contains a 'messages' array with more than
   * MAX_MESSAGES_PER_SESSION entries, it is trimmed to the most
   * recent MAX_MESSAGES_PER_SESSION entries before storage.
   */
  set(userId: string, sessionId: string, context: Record<string, unknown>): void {
    this.cleanup();

    const trimmedContext = this.trimMessages(context);
    const k = SessionStore.key(userId, sessionId);

    this.sessions.set(k, {
      context: trimmedContext,
      lastAccessed: Date.now(),
    });
  }

  /**
   * Remove a single session.
   */
  delete(userId: string, sessionId: string): void {
    this.sessions.delete(SessionStore.key(userId, sessionId));
  }

  /**
   * Return all active (non-expired) session IDs for a given user.
   */
  getActiveSessionsForUser(userId: string): string[] {
    this.cleanup();

    const prefix = `${userId}:`;
    const activeIds: string[] = [];

    for (const [k] of this.sessions) {
      if (k.startsWith(prefix)) {
        const sessionId = k.slice(prefix.length);
        activeIds.push(sessionId);
      }
    }

    return activeIds;
  }

  /**
   * Remove all sessions belonging to a user.
   */
  terminateAllUserSessions(userId: string): void {
    const prefix = `${userId}:`;
    for (const k of [...this.sessions.keys()]) {
      if (k.startsWith(prefix)) {
        this.sessions.delete(k);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Remove all expired sessions from the map.
   * Called lazily on every get/set to avoid needing a background timer.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [k, entry] of this.sessions) {
      if (entry.lastAccessed + SESSION_TTL_MS < now) {
        this.sessions.delete(k);
      }
    }
  }

  /**
   * Trim the 'messages' array in the context to at most MAX_MESSAGES_PER_SESSION.
   * Returns a shallow copy of the context with the trimmed array.
   */
  private trimMessages(context: Record<string, unknown>): Record<string, unknown> {
    const messages = context['messages'];
    if (!Array.isArray(messages) || messages.length <= MAX_MESSAGES_PER_SESSION) {
      return context;
    }

    return {
      ...context,
      messages: messages.slice(-MAX_MESSAGES_PER_SESSION),
    };
  }
}

// Pre-constructed singleton
export const sessionStore = SessionStore.getInstance();
