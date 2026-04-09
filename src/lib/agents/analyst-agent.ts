/**
 * AnalystAgent — natural language → SQL via Snowflake Cortex Analyst REST API.
 *
 * Two modes of operation:
 *
 * 1. execute(input)
 *    Full execution: question → Cortex Analyst → SQL → Snowflake → AgentResult
 *
 * 2. prepareDataForDownstreamAgent(params)
 *    Prepares a SQL CTE for a downstream ML agent. The SQL is NOT executed —
 *    it is returned raw so the ML agent can embed it as a CTE.
 */

import { randomUUID } from 'crypto';
import { callCortexAnalyst } from '../snowflake/analyst-api';
import { executeSQL } from '../snowflake/sql-api';
import type {
  AgentInput,
  AgentResult,
  AgentArtifact,
  AgentIntent,
  ConversationMessage,
} from '../../types/agent';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_NAME = 'analyst';
const AGENT_DISPLAY_NAME = 'Cortex Analyst';
const AGENT_INTENT: AgentIntent = 'ANALYST';

// Downstream format instructions keyed by target intent
const DOWNSTREAM_FORMAT_INSTRUCTIONS: Partial<Record<AgentIntent, string>> = {
  FORECAST_PROPHET:
    "Return exactly 2 columns: DATE_TRUNC('week', date_col) AS WEEK_DATE and COUNT(*) or SUM(value_col) AS METRIC_VALUE, ordered by WEEK_DATE ascending. Do not include any other columns.",
  FORECAST_SARIMA:
    "Return exactly 2 columns: DATE_TRUNC('week', date_col) AS WEEK_DATE and COUNT(*) or SUM(value_col) AS METRIC_VALUE, ordered by WEEK_DATE ascending. Do not include any other columns.",
  FORECAST_HW:
    "Return exactly 2 columns: DATE_TRUNC('week', date_col) AS WEEK_DATE and COUNT(*) or SUM(value_col) AS METRIC_VALUE, ordered by WEEK_DATE ascending. Do not include any other columns.",
  FORECAST_XGB:
    "Return exactly 2 columns: DATE_TRUNC('week', date_col) AS WEEK_DATE and COUNT(*) or SUM(value_col) AS METRIC_VALUE, ordered by WEEK_DATE ascending. Do not include any other columns.",
  FORECAST_COMPARE:
    "Return exactly 2 columns: DATE_TRUNC('week', date_col) AS WEEK_DATE and COUNT(*) or SUM(value_col) AS METRIC_VALUE, ordered by WEEK_DATE ascending. Do not include any other columns.",
  FORECAST_AUTO:
    "Return exactly 2 columns: DATE_TRUNC('week', date_col) AS WEEK_DATE and COUNT(*) or SUM(value_col) AS METRIC_VALUE, ordered by WEEK_DATE ascending. Do not include any other columns.",
  MTREE:
    'Return columns: at least one dimension or segment column, BASELINE_SHARE as a decimal between 0 and 1, TARGET_SHARE as a decimal between 0 and 1, and SEGMENT_WEIGHT as an integer. Do not include NULL values.',
  CLUSTER:
    'Write a SELECT query that retrieves an entity identifier (such as a physician ID, customer ID, or product ID) and the key numeric metrics relevant to the segmentation question (e.g. volume, share, cost). Replace any NULL values with 0. Limit to 5000 rows.',
};

const FORECAST_INTENTS = new Set<AgentIntent>([
  'FORECAST_PROPHET',
  'FORECAST_SARIMA',
  'FORECAST_HW',
  'FORECAST_XGB',
  'FORECAST_COMPARE',
  'FORECAST_AUTO',
]);

// ---------------------------------------------------------------------------
// Internal API message shape (mirrors analyst-api.ts internal type)
// ---------------------------------------------------------------------------

interface AnalystMessage {
  role: 'user' | 'analyst';
  content: Array<{ type: string; text?: string; statement?: string; suggestions?: string[] }>;
}

// ---------------------------------------------------------------------------
// prepareDataForDownstreamAgent return type
// ---------------------------------------------------------------------------

export interface PreparedData {
  sql?: string;
  dateCol?: string;
  valueCol?: string;
  error?: string;
  lineageId?: string;
}

// ---------------------------------------------------------------------------
// AnalystAgent
// ---------------------------------------------------------------------------

export class AnalystAgent {
  readonly name = AGENT_NAME;
  readonly displayName = AGENT_DISPLAY_NAME;
  readonly description =
    'Translates natural language questions into SQL using Snowflake Cortex Analyst and executes them against your semantic view.';
  readonly intent: AgentIntent = AGENT_INTENT;

  // -------------------------------------------------------------------------
  // execute — full question → SQL → result pipeline
  // -------------------------------------------------------------------------

  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    const lineageId = randomUUID();

    if (!input.message.trim()) {
      return this.makeErrorResult('Question must not be empty.', 'VALIDATION_ERROR', startTime, lineageId);
    }

    // ------------------------------------------------------------------
    // Cache lookup
    // ------------------------------------------------------------------
    const cacheKey = `analyst:${input.userId}:${hashString(
      input.message + input.semanticView.id + (input.userPreferences.userId ?? ''),
    )}`;
    const bypassCache = (input.extraContext?.bypassCache as boolean | undefined) ?? false;

    if (!bypassCache) {
      try {
        const { CacheManager } = await import('./cache-manager');
        const cached = await CacheManager.getInstance().get(cacheKey);
        if (cached) {
          return { ...cached, durationMs: Date.now() - startTime, retryCount: 0 };
        }
      } catch {
        // Cache unavailable — continue
      }
    }

    // ------------------------------------------------------------------
    // Rate limiter
    // ------------------------------------------------------------------
    try {
      const { RateLimiter } = await import('./rate-limiter');
      const allowed = await RateLimiter.getInstance().checkAndConsume(input.userId);
      if (!allowed) {
        return this.makeErrorResult(
          'Rate limit exceeded. Please wait before sending another request.',
          'RATE_LIMITED',
          startTime,
          lineageId,
        );
      }
    } catch {
      // Rate limiter unavailable — proceed
    }

    // ------------------------------------------------------------------
    // Build conversation history for the API call
    // ------------------------------------------------------------------
    const conversationHistory = this.buildConversationHistory(input.conversationHistory);

    // Extract abort signal threaded from the route handler
    const abortSignal = input.extraContext?.abortSignal as AbortSignal | undefined;

    // ------------------------------------------------------------------
    // Call Cortex Analyst / SRI_ANALYST_AGENT
    // ------------------------------------------------------------------
    const analystResponse = await callCortexAnalyst({
      question: input.message,
      semanticView: input.semanticView.fullyQualifiedName,
      conversationHistory,
      signal: abortSignal,
    });

    if (analystResponse.error) {
      return this.makeErrorResult(
        analystResponse.error,
        'ANALYST_API_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // Execute the generated SQL if present
    // ------------------------------------------------------------------
    let sqlRows: Record<string, unknown>[] = [];
    let sqlColumns: string[] = [];
    const sql = analystResponse.sql;

    if (sql) {
      try {
        // Do not prepend USE ROLE — the PAT already authenticates as the
        // correct role. Passing a role argument would create a 2-statement
        // request that conflicts with the default statement count of 1.
        const sqlResult = await executeSQL(sql, undefined, abortSignal);
        sqlRows = sqlResult.rows;
        sqlColumns = sqlResult.columns;
      } catch (err) {
        return this.makeErrorResult(
          `SQL execution failed: ${err instanceof Error ? err.message : String(err)}`,
          'SQL_EXECUTION_ERROR',
          startTime,
          lineageId,
        );
      }
    }

    // ------------------------------------------------------------------
    // Build primary artifact — single object carrying both SQL and results
    // so downstream synthesizer + chat UI can read rows without losing SQL.
    // Shape: { results: { headers: string[], rows: (string|number)[][] } }
    // mirrors what artifactToTableData() and the synthesizer expect.
    // ------------------------------------------------------------------
    const resultRows: (string | number)[][] = sqlRows.map((row) =>
      sqlColumns.map((col) => row[col] as string | number),
    );

    const primaryArtifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: sql
        ? {
            results: sqlRows.length > 0
              ? { headers: sqlColumns, rows: resultRows }
              : undefined,
          }
        : { type: 'text', text: analystResponse.text, suggestions: analystResponse.suggestions },
      sql: sql ?? undefined,
      narrative: analystResponse.text || undefined,
      createdAt: Date.now(),
      lineageId,
      cacheStatus: 'miss',
    };

    const result: AgentResult = {
      success: true,
      artifact: primaryArtifact,
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };

    // ------------------------------------------------------------------
    // Lineage + cache (non-blocking)
    // ------------------------------------------------------------------
    this.recordLineage(input, lineageId).catch(() => {});
    if (!bypassCache) {
      this.storeInCache(cacheKey, result).catch(() => {});
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // prepareDataForDownstreamAgent
  // -------------------------------------------------------------------------

  /**
   * Ask Cortex Analyst to generate a SQL SELECT appropriate for feeding into
   * a downstream ML agent. Returns the raw SQL without executing it.
   */
  async prepareDataForDownstreamAgent(params: {
    userQuestion: string;
    targetAgent: AgentIntent;
    context: AgentInput;
  }): Promise<PreparedData> {
    const { userQuestion, targetAgent, context } = params;
    const lineageId = randomUUID();

    const formatInstruction = DOWNSTREAM_FORMAT_INSTRUCTIONS[targetAgent];
    const augmentedQuestion = formatInstruction
      ? `${userQuestion}\n\nIMPORTANT — Output format requirement: ${formatInstruction}`
      : userQuestion;

    const conversationHistory = this.buildConversationHistory(context.conversationHistory);
    const abortSignal = context.extraContext?.abortSignal as AbortSignal | undefined;

    const analystResponse = await callCortexAnalyst({
      question: augmentedQuestion,
      semanticView: context.semanticView.fullyQualifiedName,
      conversationHistory,
      signal: abortSignal,
    });

    if (analystResponse.error) {
      return { error: analystResponse.error, lineageId };
    }

    if (!analystResponse.sql) {
      return {
        error: 'Cortex Analyst did not return SQL for the data preparation step.',
        lineageId,
      };
    }

    // Record lineage for this prep step (non-blocking)
    this.recordLineage(context, lineageId).catch(() => {});

    const isForecast = FORECAST_INTENTS.has(targetAgent);

    return {
      sql: analystResponse.sql,
      dateCol: isForecast ? 'WEEK_DATE' : undefined,
      valueCol: isForecast ? 'METRIC_VALUE' : undefined,
      lineageId,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildConversationHistory(messages: ConversationMessage[]): AnalystMessage[] {
    return messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m): AnalystMessage => ({
        role: m.role === 'assistant' ? 'analyst' : 'user',
        content: [{ type: 'text', text: m.content }],
      }));
  }

  private makeErrorResult(
    error: string,
    errorType: string,
    startTime: number,
    lineageId: string,
  ): AgentResult {
    const artifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: null,
      narrative: `Error (${errorType}): ${error}`,
      createdAt: Date.now(),
      lineageId,
      cacheStatus: 'error',
    };
    return {
      success: false,
      artifact,
      error,
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };
  }

  private async recordLineage(input: AgentInput, lineageId: string): Promise<void> {
    const { LineageTracker } = await import('./lineage-tracker');
    await LineageTracker.getInstance().record({
      lineageId,
      sessionId: input.sessionId,
      userId: input.userId,
      intent: this.intent,
      agentName: this.name,
    });
  }

  private async storeInCache(cacheKey: string, result: AgentResult): Promise<void> {
    const { CacheManager } = await import('./cache-manager');
    await CacheManager.getInstance().set(cacheKey, result);
  }
}

// ---------------------------------------------------------------------------
// Utility: stable string hash (FNV-1a 32-bit, hex)
// ---------------------------------------------------------------------------

function hashString(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const analystAgent = new AnalystAgent();
