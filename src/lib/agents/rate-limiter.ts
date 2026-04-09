/**
 * RateLimiter — sliding-window token-bucket rate limiter.
 *
 * Each user gets an allowance of `requestsPerWindow` requests within a
 * rolling `windowMs` period. Consumption is tracked in memory; a future
 * replacement can swap this for Redis INCR/EXPIRE without API changes.
 *
 * Methods:
 *   checkAndConsume(userId)  — returns true if allowed, false if limited
 *   getStatus(userId)        — returns the current RateLimitStatus
 *   reset(userId)            — clear the counter for a user (admin use)
 */

import type { RateLimitStatus } from '../../types/user';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_MS = 60 * 1_000; // 1 minute
const DEFAULT_REQUESTS_PER_WINDOW = 30;
const DEFAULT_TOKENS_LIMIT = 500_000; // future LLM token budget placeholder

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface BucketEntry {
  /** Timestamps (ms) of each request in the current window */
  timestamps: number[];
  /** Approximate tokens consumed — incremented by caller in future */
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

export class RateLimiter {
  private static instance: RateLimiter;

  private readonly buckets = new Map<string, BucketEntry>();
  private readonly windowMs: number;
  private readonly requestsPerWindow: number;

  private constructor(
    windowMs = DEFAULT_WINDOW_MS,
    requestsPerWindow = DEFAULT_REQUESTS_PER_WINDOW,
  ) {
    this.windowMs = windowMs;
    this.requestsPerWindow = requestsPerWindow;
  }

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Check whether the user has remaining quota and, if so, consume one slot.
   *
   * @returns true if the request is allowed, false if rate-limited.
   */
  async checkAndConsume(userId: string): Promise<boolean> {
    const bucket = this.getBucket(userId);
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Slide the window: remove timestamps outside the current window
    bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

    if (bucket.timestamps.length >= this.requestsPerWindow) {
      return false;
    }

    bucket.timestamps.push(now);
    return true;
  }

  /**
   * Return the current rate-limit status for a user without consuming quota.
   */
  async getStatus(userId: string): Promise<RateLimitStatus> {
    const bucket = this.getBucket(userId);
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Slide the window without consuming
    bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

    const requestsUsed = bucket.timestamps.length;
    const isLimited = requestsUsed >= this.requestsPerWindow;

    // Earliest timestamp in the window is when the oldest slot expires
    const oldestInWindow = bucket.timestamps[0];
    const windowResetsAt = oldestInWindow
      ? oldestInWindow + this.windowMs
      : now + this.windowMs;

    return {
      userId,
      requestsUsed,
      requestsLimit: this.requestsPerWindow,
      tokensUsed: bucket.tokensUsed,
      tokensLimit: DEFAULT_TOKENS_LIMIT,
      windowResetsAt,
      isLimited,
    };
  }

  /**
   * Reset the rate-limit counter for a user.
   * Intended for admin use (e.g., after a subscription upgrade).
   */
  async reset(userId: string): Promise<void> {
    this.buckets.delete(userId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getBucket(userId: string): BucketEntry {
    let bucket = this.buckets.get(userId);
    if (!bucket) {
      bucket = { timestamps: [], tokensUsed: 0 };
      this.buckets.set(userId, bucket);
    }
    return bucket;
  }
}

// Pre-constructed singleton
export const rateLimiter = RateLimiter.getInstance();
