/**
 * AnalystAgent — natural language → SQL via Snowflake Cortex Analyst REST API.
 *
 * Blueprint v3.0 role: PATH A of the RouteDispatcher.
 * Handles open-ended data-exploration queries (intent = ANALYST).
 *
 * execute(input)
 *   Full execution: question → Cortex Analyst → SQL → Snowflake → AgentResult
 *
 * prepareDataForDownstreamAgent(params)
 *   @deprecated v3.0 — Named Cortex Agents handle data prep internally.
 *   Kept for reference; no longer called by the dispatcher.
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

// Simple hints keyed by target intent — used in Pass 1 to guide Cortex Analyst
// without imposing rigid schema requirements (those are handled in Pass 2).
const DOWNSTREAM_HINTS: Partial<Record<AgentIntent, string>> = {
  FORECAST_PROPHET: 'Return time series data with a date column and a numeric metric column.',
  FORECAST_SARIMA: 'Return time series data with a date column and a numeric metric column.',
  FORECAST_HW: 'Return time series data with a date column and a numeric metric column.',
  FORECAST_XGB: 'Return time series data with a date column and a numeric metric column.',
  FORECAST_HYBRID: 'Return time series data with a date column and a numeric metric column.',
  FORECAST_COMPARE: 'Return time series data with a date column and a numeric metric column.',
  FORECAST_AUTO: 'Return time series data with a date column and a numeric metric column.',
  MTREE: 'Return segmented data with a segment or group column and numeric metrics (counts, shares, or amounts).',
  CLUSTER: 'Return a physician-level summary. Include physician_key and numeric aggregations (claim counts, patient counts, drug counts, payment amounts).',
  CLUSTER_GM: 'Return a physician-level summary. Include physician_key and numeric aggregations (claim counts, patient counts, drug counts, payment amounts).',
  CLUSTER_DBSCAN: 'Return a physician-level summary. Include physician_key and numeric aggregations (claim counts, patient counts, drug counts, payment amounts).',
  CLUSTER_HIERARCHICAL: 'Return a physician-level summary. Include physician_key and numeric aggregations (claim counts, patient counts, drug counts, payment amounts).',
  CLUSTER_KMEANS: 'Return a physician-level summary. Include physician_key and numeric aggregations (claim counts, patient counts, drug counts, payment amounts).',
  CLUSTER_KMEDOIDS: 'Return a physician-level summary. Include physician_key and numeric aggregations (claim counts, patient counts, drug counts, payment amounts).',
  CLUSTER_COMPARE: 'Return a physician-level summary. Include physician_key and numeric aggregations (claim counts, patient counts, drug counts, payment amounts).',
  CAUSAL_AUTO: 'Return longitudinal data with a period/date column, an outcome metric column, and at least one driver/feature column.',
  CAUSAL_CONTRIBUTION: 'Return longitudinal data with a period/date column, an outcome metric column, and at least one driver/feature column. Include a period label column distinguishing baseline from target periods.',
  CAUSAL_DRIVERS: 'Return panel data with an outcome metric column and multiple potential driver/feature columns.',
  CAUSAL_VALIDATION: 'Return longitudinal data with a period/date column, an outcome metric column, and a binary treatment indicator column (0=control, 1=treated).',
  CAUSAL_NARRATIVE: 'Return the structured output of a prior causal analysis function (CAUSAL_CONTRIBUTION or CAUSAL_DRIVERS).',
  CAUSAL_PIPELINE: 'Return longitudinal panel data with a period column, outcome metric, treatment indicator, and driver/feature columns.',
};

const FORECAST_INTENTS = new Set<AgentIntent>([
  'FORECAST_PROPHET',
  'FORECAST_SARIMA',
  'FORECAST_HW',
  'FORECAST_XGB',
  'FORECAST_HYBRID',
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
    const question = input.message;

    console.time('5a_ANALYST_REST_CALL');
    const analystResponse = await callCortexAnalyst({
      question,
      semanticView: input.semanticView.fullyQualifiedName,
      conversationHistory,
      signal: abortSignal,
    });
    console.timeEnd('5a_ANALYST_REST_CALL');

    if (analystResponse.error) {
      console.error('[AnalystAgent] Cortex Analyst error:', analystResponse.error);
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
    const sql = analystResponse.sql ?? null;

    console.log('[AnalystAgent] generated SQL:', sql ?? '(none)');

    if (sql) {
      try {
        // Do not prepend USE ROLE — the PAT already authenticates as the
        // correct role. Passing a role argument would create a 2-statement
        // request that conflicts with the default statement count of 1.
        console.time('5b_SQL_EXECUTION');
        const sqlResult = await executeSQL(sql, undefined, abortSignal);
        console.timeEnd('5b_SQL_EXECUTION');
        sqlRows = sqlResult.rows;
        sqlColumns = sqlResult.columns;
        console.log('[AnalystAgent] columns:', sqlColumns.join(', '));
        console.log('[AnalystAgent] row[0]:', JSON.stringify(sqlRows[0]));
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

    // ------------------------------------------------------------------
    // Narrative enrichment via Claude Haiku
    // The direct Cortex Analyst API returns a brief text explanation.
    // If it's short and we have data, enrich it with key observations.
    // ------------------------------------------------------------------
    let narrative = analystResponse.text || undefined;
    if (sqlRows.length > 0 && (!narrative || narrative.length < 300)) {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const claudeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const sampleRows = resultRows.slice(0, 5)
          .map((r) => sqlColumns.map((col, i) => `${col}: ${r[i]}`).join(', '))
          .join('\n');
        const resp = await claudeClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: `Question: "${input.message}"\nColumns: ${sqlColumns.join(', ')}\nRow count: ${sqlRows.length}\nSample rows:\n${sampleRows}\n\nWrite 2-3 concise bullet points summarising key insights. Be specific with numbers.`,
          }],
        });
        const block = resp.content[0];
        if (block.type === 'text') narrative = block.text;
      } catch {
        // Non-blocking — fall back to Cortex Analyst text
      }
    }

    const primaryArtifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: sql && sqlColumns.length > 0
        ? {
            // Always include headers so the table renders even when the query
            // returns 0 rows — the DataTable will show "0 rows" with column names.
            results: { headers: sqlColumns, rows: resultRows },
          }
        : analystResponse.data !== undefined
          ? analystResponse.data
          : { type: 'text', text: analystResponse.text, suggestions: analystResponse.suggestions },
      sql: sql ?? undefined,
      narrative,
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
   * Two-pass data preparation for downstream ML agents.
   *
   * Pass 1 — natural language → raw SQL:
   *   Ask Cortex Analyst a focused but schema-free question. We only hint at
   *   the kind of data needed (time series, physician-level, segmented) without
   *   imposing rigid column aliases that confuse the Analyst.
   *
   * Pass 2 — column introspection → schema-compliant SQL:
   *   Dry-run the raw SQL (LIMIT 1) to discover actual column names and one
   *   sample row, then use SQLTransformer to wrap it in a CTE that produces
   *   the exact schema each ML agent expects.
   *
   * @deprecated Blueprint v3.0 — Named Snowflake Cortex Agents
   * (SRI_FORECAST_AGENT, SRI_CLUSTERING_AGENT, SRI_META_TREE,
   * SRI_CAUSAL_INFERENCE_AGENT) handle all data preparation and SQL
   * construction internally.  The RouteDispatcher and PipelineExecutor now
   * call callCortexAgent() directly.  This method is kept to avoid breaking
   * any external references but is no longer called by the dispatcher.
   */
  async prepareDataForDownstreamAgent(params: {
    userQuestion: string;
    targetAgent: AgentIntent;
    context: AgentInput;
  }): Promise<PreparedData> {
    const { userQuestion, targetAgent, context } = params;
    const lineageId = randomUUID();

    const conversationHistory = this.buildConversationHistory(context.conversationHistory);
    const abortSignal = context.extraContext?.abortSignal as AbortSignal | undefined;

    // ------------------------------------------------------------------
    // Pass 1 — natural language → raw SQL via Cortex Analyst
    // ------------------------------------------------------------------
    const primaryQuestion = this.buildSimpleQuestion(userQuestion, targetAgent);

    const analystResponse = await callCortexAnalyst({
      question: primaryQuestion,
      semanticView: context.semanticView.fullyQualifiedName,
      conversationHistory,
      signal: abortSignal,
    });

    if (analystResponse.error) {
      return { error: analystResponse.error, lineageId };
    }

    let rawSql = analystResponse.sql;

    // Retry with a more explicit fallback if no SQL was returned
    if (!rawSql) {
      const fallbackQuestion = this.buildFallbackQuestion(targetAgent);
      if (fallbackQuestion) {
        const retryResponse = await callCortexAnalyst({
          question: fallbackQuestion,
          semanticView: context.semanticView.fullyQualifiedName,
          signal: abortSignal,
        });
        if (!retryResponse.error) rawSql = retryResponse.sql;
      }
    }

    if (!rawSql) {
      const agentText = analystResponse.text?.slice(0, 300) || '(no text)';
      return {
        error: `Cortex Analyst did not return SQL. Agent response: "${agentText}"`,
        lineageId,
      };
    }

    // ------------------------------------------------------------------
    // Pass 2 — dry-run → column metadata → schema-compliant SQL
    // ------------------------------------------------------------------
    const { SchemaValidator } = await import('./schema-validator');
    const dryRun = await SchemaValidator.dryRun(rawSql, abortSignal);

    if (dryRun.error) {
      // Dry-run failed — return raw SQL and let the downstream agent handle it
      this.recordLineage(context, lineageId).catch(() => {});
      return { sql: rawSql, lineageId };
    }

    const { SQLTransformer } = await import('./sql-transformer');
    let transformResult: import('./sql-transformer').TransformResult;

    if (FORECAST_INTENTS.has(targetAgent)) {
      transformResult = SQLTransformer.transformForForecast(rawSql, dryRun.columns, dryRun.sampleRow);
    } else if (targetAgent === 'CLUSTER') {
      transformResult = SQLTransformer.transformForCluster(rawSql, dryRun.columns, dryRun.sampleRow);
    } else if (targetAgent === 'MTREE') {
      transformResult = SQLTransformer.transformForMTree(rawSql, dryRun.columns, dryRun.sampleRow);
    } else {
      transformResult = { sql: rawSql };
    }

    if (transformResult.error) {
      // Transformation couldn't map columns — fall back to raw SQL
      this.recordLineage(context, lineageId).catch(() => {});
      return { sql: rawSql, lineageId };
    }

    this.recordLineage(context, lineageId).catch(() => {});

    return {
      sql: transformResult.sql,
      dateCol: transformResult.dateCol,
      valueCol: transformResult.valueCol,
      lineageId,
    };
  }

  // -------------------------------------------------------------------------
  // Question builders
  // -------------------------------------------------------------------------

  /**
   * Build a natural-language question for Cortex Analyst.
   * The question includes a light hint about the data shape needed
   * but does NOT impose rigid column aliases — those are applied in Pass 2
   * by SQLTransformer after we introspect the actual columns.
   */
  private buildSimpleQuestion(userQuestion: string, targetAgent: AgentIntent): string {
    // For all CLUSTER_* variants, the user question often contains ML directives
    // ("Use GMM clustering", "segment into N groups", "DBSCAN with eps=0.5") that
    // confuse Cortex Analyst. Replace entirely with a clean data-retrieval question —
    // the clustering algorithm is handled downstream.
    const isClusterIntent = (
      targetAgent === 'CLUSTER' ||
      targetAgent === 'CLUSTER_GM' ||
      targetAgent === 'CLUSTER_DBSCAN' ||
      targetAgent === 'CLUSTER_HIERARCHICAL' ||
      targetAgent === 'CLUSTER_KMEANS' ||
      targetAgent === 'CLUSTER_KMEDOIDS' ||
      targetAgent === 'CLUSTER_COMPARE'
    );

    if (isClusterIntent) {
      return (
        'Show me a physician-level summary with prescribing metrics: ' +
        'physician_key, total dispensed claims, number of distinct drugs prescribed, ' +
        'number of distinct patients, average days supply, average patient out-of-pocket cost, ' +
        'average plan payment amount. Filter to dispensed claims only.'
      );
    }

    // For CAUSAL_* intents, strip algorithm-specific language and keep the
    // data retrieval part of the question.
    const isCausalIntent = (
      targetAgent === 'CAUSAL_AUTO' ||
      targetAgent === 'CAUSAL_CONTRIBUTION' ||
      targetAgent === 'CAUSAL_DRIVERS' ||
      targetAgent === 'CAUSAL_VALIDATION' ||
      targetAgent === 'CAUSAL_NARRATIVE' ||
      targetAgent === 'CAUSAL_PIPELINE'
    );

    if (isCausalIntent) {
      const hint = DOWNSTREAM_HINTS[targetAgent];
      return hint
        ? `${userQuestion}\n\nData shape needed: ${hint}`
        : userQuestion;
    }

    const hint = DOWNSTREAM_HINTS[targetAgent];
    return hint ? `${userQuestion}\n\nData shape needed: ${hint}` : userQuestion;
  }

  /**
   * Fallback question used when Cortex Analyst returns no SQL on the first try.
   * More explicit than the primary question to maximize the chance of getting SQL.
   */
  private buildFallbackQuestion(targetAgent: AgentIntent): string | null {
    const clusterIntents: AgentIntent[] = [
      'CLUSTER', 'CLUSTER_GM', 'CLUSTER_DBSCAN', 'CLUSTER_HIERARCHICAL',
      'CLUSTER_KMEANS', 'CLUSTER_KMEDOIDS', 'CLUSTER_COMPARE',
    ];
    if (clusterIntents.includes(targetAgent)) {
      return 'Show me total claim count, unique patient count, and average days supply per physician. Limit to 5000 rows.';
    }

    if (FORECAST_INTENTS.has(targetAgent)) {
      return 'Show total claim count by week ordered by week ascending. Use claim_status_code = 1. Limit 500 rows.';
    }

    if (targetAgent === 'MTREE') {
      return 'Show brand share and total share by physician segment. Include segment name, brand claims count, total claims count, and percentage brand share.';
    }

    const causalIntents: AgentIntent[] = [
      'CAUSAL_AUTO', 'CAUSAL_CONTRIBUTION', 'CAUSAL_DRIVERS',
      'CAUSAL_VALIDATION', 'CAUSAL_PIPELINE',
    ];
    if (causalIntents.includes(targetAgent)) {
      return 'Show total dispensed claim count, brand claim count, and generic claim count by physician and month. Include physician_key, month, and all three counts. Limit to 2000 rows.';
    }

    return null;
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
