/**
 * cron-utils — helpers for parsing, validating, and describing cron expressions.
 */

import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';

// ---------------------------------------------------------------------------
// getNextRunTime
// ---------------------------------------------------------------------------

/**
 * Returns the next scheduled Date for the given cron expression in the
 * specified IANA timezone, or null if the expression is invalid.
 */
export function getNextRunTime(cronExpression: string, timezone: string): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// describeCron
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable description of the cron expression, e.g.
 * "Every day at 9:00 AM".  Falls back to the raw expression on error.
 */
export function describeCron(cronExpression: string, timezone: string): string {
  try {
    const description = cronstrue.toString(cronExpression, {
      use24HourTimeFormat: false,
      verbose: false,
    });
    return timezone ? `${description} (${timezone})` : description;
  } catch {
    return cronExpression;
  }
}

// ---------------------------------------------------------------------------
// validateCron
// ---------------------------------------------------------------------------

/**
 * Returns { valid: true } when the expression is parseable, or
 * { valid: false, error: string } when it is not.
 */
export function validateCron(cronExpression: string): { valid: boolean; error?: string } {
  try {
    CronExpressionParser.parse(cronExpression);
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid cron expression.',
    };
  }
}

// ---------------------------------------------------------------------------
// getNextNRuns
// ---------------------------------------------------------------------------

/**
 * Returns the next `n` scheduled run Dates for the given expression.
 * Returns an empty array if the expression is invalid or `n` is zero.
 */
export function getNextNRuns(
  cronExpression: string,
  timezone: string,
  n: number,
): Date[] {
  if (n <= 0) return [];

  try {
    const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
    const dates: Date[] = [];
    for (let i = 0; i < n; i++) {
      dates.push(interval.next().toDate());
    }
    return dates;
  } catch {
    return [];
  }
}
