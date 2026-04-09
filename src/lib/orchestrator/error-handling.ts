/**
 * Error handling utilities — retry configuration, error classification,
 * and a lightweight CircuitBreaker for Snowflake / agent calls.
 */

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

export interface RetryConfig {
  maxRetries: number;
  retryableErrors: string[];
  nonRetryableErrors: string[];
  backoffMs: number[];
  stepTimeoutMs: number;
}

export const RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  retryableErrors: [
    'NETWORK_ERROR',
    'TIMEOUT',
    'RATE_LIMIT',
    'WAREHOUSE_SUSPENDED',
    'QUERY_CANCELLED',
    'SERVICE_UNAVAILABLE',
    'INTERNAL_ERROR',
  ],
  nonRetryableErrors: [
    'AUTH_ERROR',
    'PERMISSION_DENIED',
    'INVALID_SQL',
    'COMPILATION_ERROR',
    'OBJECT_NOT_FOUND',
    'QUOTA_EXCEEDED',
    'VALIDATION_ERROR',
  ],
  backoffMs: [1000, 3000],
  stepTimeoutMs: 120_000,
};

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Maps an unknown thrown value to a typed error string.
 * Inspects Snowflake error codes, HTTP status codes, and message patterns.
 */
export function classifyError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    // Snowflake-specific codes/patterns
    if (msg.includes('390114') || msg.includes('jwt token')) return 'AUTH_ERROR';
    if (msg.includes('390100') || msg.includes('incorrect username')) return 'AUTH_ERROR';
    if (msg.includes('001003') || msg.includes('syntax error')) return 'COMPILATION_ERROR';
    if (msg.includes('001757') || msg.includes('invalid identifier')) return 'COMPILATION_ERROR';
    if (msg.includes('002003') || msg.includes('does not exist')) return 'OBJECT_NOT_FOUND';
    if (msg.includes('003001') || msg.includes('insufficient privileges')) return 'PERMISSION_DENIED';
    if (msg.includes('604') || msg.includes('query cancelled')) return 'QUERY_CANCELLED';
    if (msg.includes('user abort') || msg.includes('statement timed out')) return 'TIMEOUT';
    if (msg.includes('warehouse') && msg.includes('suspend')) return 'WAREHOUSE_SUSPENDED';

    // HTTP / network patterns
    if (msg.includes('429') || msg.includes('rate limit')) return 'RATE_LIMIT';
    if (msg.includes('503') || msg.includes('service unavailable')) return 'SERVICE_UNAVAILABLE';
    if (msg.includes('500') || msg.includes('internal server error')) return 'INTERNAL_ERROR';
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('econnrefused'))
      return 'NETWORK_ERROR';
    if (msg.includes('etimedout') || msg.includes('timed out')) return 'TIMEOUT';
    if (msg.includes('quota')) return 'QUOTA_EXCEEDED';
    if (msg.includes('invalid') || msg.includes('validation')) return 'VALIDATION_ERROR';
  }

  return 'UNKNOWN_ERROR';
}

/**
 * Returns true if the error type should trigger a retry attempt.
 */
export function isRetryable(errorType: string): boolean {
  return RETRY_CONFIG.retryableErrors.includes(errorType);
}

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

interface BreakerEntry {
  count: number;
  firstFailure: number;
}

const FAILURE_THRESHOLD = 3;
const WINDOW_MS = 10 * 60 * 1_000; // 10 minutes

export class CircuitBreaker {
  private failures: Map<string, BreakerEntry> = new Map();

  recordFailure(key: string): void {
    const now = Date.now();
    const existing = this.failures.get(key);

    if (!existing || now - existing.firstFailure > WINDOW_MS) {
      // Start a fresh window
      this.failures.set(key, { count: 1, firstFailure: now });
    } else {
      existing.count += 1;
    }
  }

  isOpen(key: string): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;

    const now = Date.now();
    // Expired window — treat as closed
    if (now - entry.firstFailure > WINDOW_MS) {
      this.failures.delete(key);
      return false;
    }

    return entry.count >= FAILURE_THRESHOLD;
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

/** Shared singleton breaker used by PipelineExecutor and RouteDispatcher. */
export const circuitBreaker = new CircuitBreaker();
