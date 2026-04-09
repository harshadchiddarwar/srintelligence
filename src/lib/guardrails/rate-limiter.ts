/**
 * RateLimiter — per-user sliding-window query rate + daily credit budget.
 */

import { executeSQL } from '../snowflake/sql-api';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remainingQueries: number;
  remainingCredits: number;
  retryAfterMs?: number;
  reason?: string;
}

export interface RateLimitStatus {
  userId: string;
  requestsUsed: number;
  requestsLimit: number;
  tokensUsed: number;
  tokensLimit: number;
  windowResetsAt: number;
  isLimited: boolean;
}

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

interface WindowEntry {
  count: number;
  windowStart: number;
}

interface CreditEntry {
  credits: number;
  dayStart: number;
}

interface UserLimits {
  queriesPerHour: number;
  creditsPerDay: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_QUERIES_PER_HOUR = 200;
const DEFAULT_CREDITS_PER_DAY = 100;
const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// RateLimiter (singleton)
// ---------------------------------------------------------------------------

export class RateLimiter {
  private static instance: RateLimiter;

  private windows: Map<string, WindowEntry> = new Map();
  private creditTracking: Map<string, CreditEntry> = new Map();
  private userLimits: Map<string, UserLimits> = new Map();

  private constructor() {}

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  // ---------------------------------------------------------------------------
  // Core check
  // ---------------------------------------------------------------------------

  async checkAndConsume(userId: string): Promise<RateLimitResult> {
    const limits = this.userLimits.get(userId) ?? {
      queriesPerHour: DEFAULT_QUERIES_PER_HOUR,
      creditsPerDay: DEFAULT_CREDITS_PER_DAY,
    };

    const now = Date.now();

    // --- Hourly window ---
    let window = this.windows.get(userId);
    if (!window || now - window.windowStart > HOUR_MS) {
      window = { count: 0, windowStart: now };
      this.windows.set(userId, window);
    }

    if (window.count >= limits.queriesPerHour) {
      const retryAfterMs = HOUR_MS - (now - window.windowStart);
      return {
        allowed: false,
        remainingQueries: 0,
        remainingCredits: this.getRemainingCredits(userId, limits.creditsPerDay),
        retryAfterMs,
        reason: `Hourly query limit reached (${limits.queriesPerHour}/hr). Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
      };
    }

    // --- Daily credit budget ---
    const remaining = this.getRemainingCredits(userId, limits.creditsPerDay);
    if (remaining <= 0) {
      return {
        allowed: false,
        remainingQueries: limits.queriesPerHour - window.count,
        remainingCredits: 0,
        reason: 'Daily credit budget exhausted.',
      };
    }

    // Consume one query slot
    window.count += 1;

    return {
      allowed: true,
      remainingQueries: limits.queriesPerHour - window.count,
      remainingCredits: remaining,
    };
  }

  // ---------------------------------------------------------------------------
  // Credit usage
  // ---------------------------------------------------------------------------

  recordCreditUsage(userId: string, credits: number): void {
    const now = Date.now();
    const today = this.utcDayStart(now);

    let entry = this.creditTracking.get(userId);
    if (!entry || entry.dayStart !== today) {
      entry = { credits: 0, dayStart: today };
      this.creditTracking.set(userId, entry);
    }
    entry.credits += credits;

    // Fire-and-forget Snowflake log
    this.logCreditUsage(userId, credits).catch(() => { /* ignore */ });
  }

  private async logCreditUsage(userId: string, credits: number): Promise<void> {
    const sql = `
      INSERT INTO CORTEX_TESTING.PUBLIC.CREDIT_USAGE_LOG
        (user_id, credits_consumed, recorded_at)
      VALUES
        ('${userId}', ${credits}, CURRENT_TIMESTAMP())
    `;
    await executeSQL(sql);
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  async getStatus(userId: string): Promise<RateLimitStatus> {
    const limits = this.userLimits.get(userId) ?? {
      queriesPerHour: DEFAULT_QUERIES_PER_HOUR,
      creditsPerDay: DEFAULT_CREDITS_PER_DAY,
    };

    const now = Date.now();
    const window = this.windows.get(userId);
    const requestsUsed = window && now - window.windowStart <= HOUR_MS ? window.count : 0;
    const windowResetsAt = window ? window.windowStart + HOUR_MS : now + HOUR_MS;

    const creditsUsed =
      this.creditTracking.get(userId)?.dayStart === this.utcDayStart(now)
        ? (this.creditTracking.get(userId)?.credits ?? 0)
        : 0;

    return {
      userId,
      requestsUsed,
      requestsLimit: limits.queriesPerHour,
      tokensUsed: creditsUsed,
      tokensLimit: limits.creditsPerDay,
      windowResetsAt,
      isLimited:
        requestsUsed >= limits.queriesPerHour || creditsUsed >= limits.creditsPerDay,
    };
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  setUserLimits(
    userId: string,
    limits: { queriesPerHour?: number; creditsPerDay?: number },
  ): void {
    const existing = this.userLimits.get(userId) ?? {
      queriesPerHour: DEFAULT_QUERIES_PER_HOUR,
      creditsPerDay: DEFAULT_CREDITS_PER_DAY,
    };
    this.userLimits.set(userId, {
      queriesPerHour: limits.queriesPerHour ?? existing.queriesPerHour,
      creditsPerDay: limits.creditsPerDay ?? existing.creditsPerDay,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getRemainingCredits(userId: string, limit: number): number {
    const now = Date.now();
    const today = this.utcDayStart(now);
    const entry = this.creditTracking.get(userId);
    if (!entry || entry.dayStart !== today) return limit;
    return Math.max(0, limit - entry.credits);
  }

  /** Returns the UTC midnight timestamp for the given ms epoch. */
  private utcDayStart(nowMs: number): number {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
}

export const rateLimiter = RateLimiter.getInstance();
