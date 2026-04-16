/**
 * RouteDispatcher — Blueprint v3.0 three-path orchestration entry point.
 *
 * Accepts a plain-text message, classifies intent, then routes via one of
 * three paths:
 *
 *   PATH A — cortex_analyst  → analystAgent.execute()
 *   PATH B — cortex_agent    → callCortexAgent() (named Snowflake agent)
 *   PATH C — pipeline        → PipelineExecutor (multi-step decomposition)
 *
 * The AGENT_ROUTING_MAP in agent-mapping.ts determines which path each
 * AgentIntent takes.  Named agents (PATH B) handle all SQL construction,
 * data preparation, and ML formatting internally — the web app only passes
 * the NL message and receives a structured response.
 */

import { randomUUID } from 'crypto';
import type {
  AgentIntent,
  AgentInput,
  AgentResult,
  AgentArtifact,
  DispatchEvent,
  FormattedResponse,
} from '../../types/agent';
import { ExecutionContext } from '../orchestrator/context';
import { synthesizer } from '../orchestrator/synthesizer';
import { classifyIntent } from './intent-classifier';
import { rateLimiter } from '../guardrails/rate-limiter';
import { costEstimator } from '../guardrails/cost-estimator';
import { lineageTracker } from '../lineage/lineage-tracker';
import { analystAgent } from '../agents/analyst-agent';
import { PipelineExecutor } from '../orchestrator/pipeline';
import { AGENT_ROUTING_MAP, enrichMessage, extractNClusters } from '../agents/agent-mapping';
import { callCortexAgent, SNOWFLAKE_ROLE } from '../snowflake/cortex-agent-api';
import { callCortexAnalyst } from '../snowflake/analyst-api';
import { executeSQL } from '../snowflake/sql-api';
import { executeClusteringSQL } from '../snowflake/cluster-sql';
import { persistClusteringResults } from '../snowflake/cluster-persist';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): number {
  return Date.now();
}

function baseEvent(
  type: DispatchEvent['type'],
  context: ExecutionContext,
): Omit<DispatchEvent, 'payload' | 'intent' | 'agentName' | 'error'> {
  return {
    type,
    sessionId: context.sessionId,
    userId: context.userId,
    timestamp: now(),
  };
}

/**
 * Convert a CortexAgentResponse into an AgentResult so downstream
 * synthesizer / lineage code can handle it identically to v2.x results.
 */
function buildAgentResult(
  agentRef: string,
  intent: AgentIntent,
  displayName: string,
  text: string,
  sql: string | undefined,
  data: unknown,
  executionTimeMs: number,
  lineageId: string,
  error?: string,
): AgentResult {
  if (error) {
    return {
      success: false,
      error,
      durationMs: executionTimeMs,
      retryCount: 0,
    };
  }

  // ── [FORECAST_LOG] Server-side diagnostic for forecast intents ──────────────
  if (intent.startsWith('FORECAST')) {
    console.log(`[FORECAST_LOG] intent=${intent} agent=${agentRef}`);
    console.log(`[FORECAST_LOG] text length=${text.length} chars`);
    console.log(`[FORECAST_LOG] FULL TEXT:\n${text}`);
    console.log(`[FORECAST_LOG] data type=${typeof data} isNull=${data == null}`);
    if (data != null && typeof data === 'object') {
      console.log(`[FORECAST_LOG] data keys=${JSON.stringify(Object.keys(data as object))}`);
      const d = data as Record<string, unknown>;
      if (Array.isArray(d['historical'])) console.log(`[FORECAST_LOG] historical rows=${(d['historical'] as unknown[]).length}`);
      if (Array.isArray(d['forecast']))   console.log(`[FORECAST_LOG] forecast rows=${  (d['forecast']   as unknown[]).length}`);
      if (Array.isArray(d['validation'])) console.log(`[FORECAST_LOG] validation rows=${(d['validation'] as unknown[]).length}`);
      if (d['metrics']) console.log(`[FORECAST_LOG] metrics=${JSON.stringify(d['metrics']).slice(0, 200)}`);
    }
    console.log(`[FORECAST_LOG] sql present=${!!sql}`);
  }
  // ────────────────────────────────────────────────────────────────────────────

  const artifact: AgentArtifact = {
    id: randomUUID(),
    agentName: agentRef,
    intent,
    data: data ?? null,
    sql,
    narrative: text,
    createdAt: now(),
    lineageId,
    cacheStatus: 'miss',
  };

  return {
    success: true,
    artifact,
    durationMs: executionTimeMs,
    retryCount: 0,
  };
}

/**
 * Build the UDTF SELECT for a clustering function given an intent, the
 * RECORD_ID + FEATURES input query, and the desired number of clusters
 * (0 = auto-detect).
 *
 * UDTF signatures (all 5):
 *   KMEANS_CLUSTER(RECORD_ID VARCHAR, FEATURES VARIANT, N_SEGMENTS INT)
 *   CLUSTER_GM(RECORD_ID VARCHAR, FEATURES VARIANT, N_SEGMENTS INT)
 *   KMEDOIDS_CLUSTER(RECORD_ID VARCHAR, FEATURES VARIANT, N_SEGMENTS INT)
 *   HIERARCHICAL_CLUSTER(RECORD_ID VARCHAR, FEATURES VARIANT, N_SEGMENTS INT)
 *   DBSCAN_CLUSTER(RECORD_ID VARCHAR, FEATURES VARIANT, EPS_VALUE FLOAT, MIN_SAMPLES INT)
 *
 * Call form: SELECT res.* FROM (<input_query>) AS src,
 *            TABLE(<func>(src.RECORD_ID, src.FEATURES, <params>)
 *            OVER (PARTITION BY 1)) AS res
 *
 * IMPORTANT: inputs are column references from the subquery alias `src`,
 * NOT dollar-quoted strings.  CALL syntax is not supported by the Snowflake
 * SQL API or the Cortex Agent framework.
 */
function buildClusterUDTFSQL(intent: AgentIntent, inputQuery: string, nClusters: number): string {
  // Strip Cortex Analyst comment footer and ALL semicolons.
  // Cortex Analyst may embed "LIMIT 5000;" mid-string (not just at the end),
  // and the SQL API rejects any multi-statement input.
  const inner = inputQuery
    .replace(/\s*--\s*Generated by Cortex Analyst[\s\S]*?$/gim, '')
    .replace(/;/g, '')
    .trim();

  // The source CTE name and its FROM alias.  Using an alias (`AS src`) so that
  // UDTF param references (`src.RECORD_ID`) are unambiguous and match Snowflake's
  // recommended lateral-join pattern.
  const cteName = '_cluster_src';
  const srcAlias = 'src';

  // N_SEGMENTS=0 means "auto-detect" but most UDTFs require a positive integer.
  // Default to 5 segments when the user has not specified a count.
  const nSeg = nClusters > 0 ? nClusters : 5;

  const udtfParams = (() => {
    switch (intent) {
      case 'CLUSTER_GM':
        return `CORTEX_TESTING.ML.CLUSTER_GM(${srcAlias}.RECORD_ID, ${srcAlias}.FEATURES, ${nSeg})`;
      case 'CLUSTER_KMEDOIDS':
        return `CORTEX_TESTING.ML.KMEDOIDS_CLUSTER(${srcAlias}.RECORD_ID, ${srcAlias}.FEATURES, ${nSeg})`;
      case 'CLUSTER_HIERARCHICAL':
        return `CORTEX_TESTING.ML.HIERARCHICAL_CLUSTER(${srcAlias}.RECORD_ID, ${srcAlias}.FEATURES, ${nSeg})`;
      case 'CLUSTER_DBSCAN':
        // EPS_VALUE=0.0 → auto-tune via k-distance heuristic; MIN_SAMPLES=5 default
        return `CORTEX_TESTING.ML.DBSCAN_CLUSTER(${srcAlias}.RECORD_ID, ${srcAlias}.FEATURES, 0.0::FLOAT, 5)`;
      case 'CLUSTER':
      case 'CLUSTER_KMEANS':
      default:
        return `CORTEX_TESTING.ML.KMEANS_CLUSTER(${srcAlias}.RECORD_ID, ${srcAlias}.FEATURES, ${nSeg})`;
    }
  })();

  // Final SELECT + UDTF lateral join (shared by both CTE and plain-SELECT paths)
  const selectAndUdtf = [
    `SELECT res.*`,
    `FROM ${cteName} AS ${srcAlias},`,
    `TABLE(`,
    `  ${udtfParams}`,
    `  OVER (PARTITION BY 1)`,
    `) AS res`,
  ].join('\n');

  // ── CTE hoisting ─────────────────────────────────────────────────────────────
  // Cortex Analyst often returns: WITH cte1 AS (...), cte2 AS (...) SELECT ...
  // Snowflake does not allow CTEs inside a subquery/inline view, so we keep them
  // at the top level and append _cluster_src as a new CTE wrapping the final SELECT.
  //
  // Result:
  //   WITH cte1 AS (...), cte2 AS (...),
  //   _cluster_src AS (SELECT ... FROM cte1 JOIN cte2 ...)
  //   SELECT res.* FROM _cluster_src AS src, TABLE(UDTF(src.RECORD_ID, ...) OVER (...)) AS res
  if (/^WITH\s/i.test(inner.trimStart())) {
    // Walk the string tracking paren depth; record position of every top-level SELECT.
    let depth = 0;
    let lastTopSelect = -1;
    const upper = inner.toUpperCase();
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '(') { depth++; continue; }
      if (ch === ')') { depth--; continue; }
      if (depth === 0 && upper.startsWith('SELECT', i)) {
        // Word-boundary guard: preceding char must be whitespace, newline, or comma
        const before = i > 0 ? inner[i - 1] : ' ';
        if (/[\s\n,)]/.test(before) || i === 0) {
          lastTopSelect = i;
        }
      }
    }

    if (lastTopSelect > 0) {
      const ctePart    = inner.slice(0, lastTopSelect).trimEnd(); // ends with ")"
      const selectPart = inner.slice(lastTopSelect);              // "SELECT ..."
      // Remove a stray trailing comma from the CTE block (defensive)
      const cteClean   = ctePart.replace(/,\s*$/, '');
      const sql = [
        `${cteClean},`,
        `${cteName} AS (`,
        selectPart,
        `)`,
        selectAndUdtf,
      ].join('\n');
      return sql.replace(/;/g, ''); // final safety: no stray semicolons
    }
    // Parsing failed — fall through to simple wrapper
  }

  // No CTE (or fallback) — wrap the entire query as _cluster_src
  const sql = [
    `WITH ${cteName} AS (`,
    inner,
    `)`,
    selectAndUdtf,
  ].join('\n');
  return sql.replace(/;/g, ''); // final safety: no stray semicolons
}

/**
 * Build a RECORD_ID + FEATURES SELECT directly from a prior analyst SQL result,
 * without calling Cortex Analyst again. This preserves the exact cohort (same
 * WHERE / HAVING / LIMIT as the prior query) rather than letting Cortex Analyst
 * re-interpret the population from a NL hint.
 *
 * The prior SQL is wrapped as a CTE (_prior_cohort), and we derive:
 *   RECORD_ID — first column that looks like an entity key (contains KEY, ID, NPI, GID, etc.)
 *   FEATURES  — all remaining numeric-sounding columns packed with OBJECT_CONSTRUCT
 *
 * Returns null when the prior result doesn't contain suitable columns (falls back
 * to the Cortex Analyst path).
 */
/**
 * Split a SQL string that starts with WITH into its CTE prefix block and the
 * top-level SELECT body.  Tracks parenthesis depth so that SELECT keywords
 * inside CTE bodies (depth ≥ 1) are ignored.
 *
 * Returns null if no top-level SELECT is found.
 */
function splitTopLevelSelect(sql: string): { cteBlock: string; selectBlock: string } | null {
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth === 0 && /^SELECT\b/i.test(sql.slice(i))) {
      const cteBlock   = sql.slice(0, i).trim().replace(/,\s*$/, '');
      const selectBlock = sql.slice(i).trim();
      return { cteBlock, selectBlock };
    }
  }
  return null;
}

function buildCohortClusterSQL(priorSQL: string, priorColumns: string[]): string | null {
  if (priorColumns.length < 2) return null;

  // Detect the entity ID column — prefer explicit key/id patterns
  const ID_PATTERNS = /key|_id$|^id_|^npi|gid|identifier|code$/i;
  const SKIP_PATTERNS = /name|desc|label|date|year|month|quarter|day|state|type|category|status|flag/i;

  const idCol = priorColumns.find(c => ID_PATTERNS.test(c))
    ?? priorColumns[0]; // fallback: first column

  // Feature columns: everything that isn't the ID and doesn't look like a dimension
  const featureCols = priorColumns.filter(
    c => c !== idCol && !SKIP_PATTERNS.test(c),
  );

  if (featureCols.length === 0) {
    // No numeric-looking columns — use all non-ID columns
    featureCols.push(...priorColumns.filter(c => c !== idCol));
  }
  if (featureCols.length === 0) return null;

  // TRY_CAST only accepts VARCHAR input in Snowflake — it cannot cast NUMBER to FLOAT.
  // TRY_TO_DOUBLE(col::VARCHAR) works for both numeric columns (NUMBER → VARCHAR → DOUBLE)
  // and comma-formatted string columns like "18,414" produced by TO_CHAR().
  // REPLACE strips the commas before parsing so "18,414" becomes 18414.0.
  const objectArgs = featureCols
    .map(c => `    '${c}', TRY_TO_DOUBLE(REPLACE(${c}::VARCHAR, ',', ''))`)
    .join(',\n');

  // Strip semicolons and single-line SQL comments (e.g. "-- Generated by Cortex Analyst ...")
  const inner = priorSQL
    .replace(/;/g, '')
    .replace(/--[^\n]*/g, '')
    .trim();

  // ── Flatten nested CTEs ──────────────────────────────────────────────────
  // If the prior SQL already has CTEs (`WITH … SELECT …`), wrapping the whole
  // thing as `WITH _prior_cohort AS (WITH … SELECT …)` produces invalid nested
  // WITH clauses.  Instead, promote the original CTEs to the top level and add
  // _prior_cohort as just another CTE wrapping the final SELECT body.
  let ctePrefix: string;
  if (/^\s*WITH\s+/i.test(inner)) {
    const split = splitTopLevelSelect(inner);
    if (split) {
      // split.cteBlock  = "WITH cte1 AS (...), cte2 AS (...), ..."
      // split.selectBlock = "SELECT ... FROM ... WHERE ..."
      ctePrefix = `${split.cteBlock},\n_prior_cohort AS (\n${split.selectBlock}\n)`;
    } else {
      // Couldn't parse — fall back to plain wrapping (may fail on complex SQL)
      ctePrefix = `WITH _prior_cohort AS (\n${inner}\n)`;
    }
  } else {
    ctePrefix = `WITH _prior_cohort AS (\n${inner}\n)`;
  }

  return [
    ctePrefix,
    `SELECT`,
    `  CAST(${idCol} AS VARCHAR) AS RECORD_ID,`,
    `  OBJECT_CONSTRUCT(`,
    objectArgs,
    `  )::VARIANT AS FEATURES`,
    `FROM _prior_cohort`,
    `WHERE ${idCol} IS NOT NULL`,
    `LIMIT 10000`,
  ].join('\n');
}

/**
 * Build a Cortex Analyst question that asks for a clustering input query.
 *
 * The analyst must produce a standalone SELECT with exactly 2 columns:
 *   RECORD_ID VARCHAR  — unique entity identifier
 *   FEATURES  VARIANT  — OBJECT_CONSTRUCT of numeric feature key-value pairs
 *
 * These columns are passed by reference to the clustering UDTF:
 *   TABLE(UDTF(src.RECORD_ID, src.FEATURES, n) OVER (PARTITION BY 1))
 */
function buildClusterInputQuestion(message: string, nClusters: number, priorUserQuestion?: string): string {
  const nHint = nClusters > 0
    ? `The user wants exactly ${nClusters} cluster${nClusters !== 1 ? 's' : ''}.`
    : 'The number of clusters will be auto-detected.';

  // If the user is asking to cluster a cohort identified in a prior turn, include
  // that prior question as a natural-language filter hint so Cortex Analyst applies
  // the same population scope (e.g. same drug, same date range, same specialty).
  const cohortSection = priorUserQuestion
    ? `\n\n[Context: The user previously analysed the following population — apply the same filters when selecting RECORD_IDs: "${priorUserQuestion.slice(0, 400)}"]\n`
    : '';

  return `${message}${cohortSection}

Generate a SELECT query for clustering that returns EXACTLY 2 columns (no others):
  1. RECORD_ID VARCHAR  — the unique entity identifier, cast to VARCHAR
     Example: physician_key::VARCHAR AS RECORD_ID
  2. FEATURES  VARIANT  — numeric metrics packed with OBJECT_CONSTRUCT, cast as VARIANT
     Example: OBJECT_CONSTRUCT('TOTAL_CLAIMS', COUNT(claim_id)::FLOAT, ...)::VARIANT AS FEATURES

Full example of the required format:
  SELECT physician_key::VARCHAR AS RECORD_ID,
         OBJECT_CONSTRUCT(
           'TOTAL_CLAIMS',    COUNT(claim_id)::FLOAT,
           'AVG_OOP',         AVG(primary_patient_pay)::FLOAT,
           'AVG_DAYS_SUPPLY', AVG(product_days_supply)::FLOAT,
           'UNIQUE_DRUGS',    COUNT(DISTINCT drug_id)::FLOAT,
           'UNIQUE_PATIENTS', COUNT(DISTINCT patient_gid)::FLOAT
         )::VARIANT AS FEATURES
  FROM   CORTEX_TESTING.PUBLIC.RX_TABLE
  WHERE  (ptd_final_claim = 1 OR ptd_final_claim IS NULL)
    AND  claim_status_code = '1'
    AND  primary_patient_pay IS NOT NULL
  GROUP  BY physician_key
  HAVING COUNT(*) >= 5
  LIMIT  10000

Strict rules:
  - Output a standalone SELECT only — no trailing semicolon, no CTEs, no CALL or INSERT
  - GROUP BY the entity identifier column
  - OBJECT_CONSTRUCT keys must be NUMERIC aggregates (SUM/COUNT/AVG/etc.) cast to ::FLOAT
  - Filter NULLs for all critical metric columns in the WHERE clause
  - HAVING COUNT(*) >= 5 to exclude sparse records
  - LIMIT 10000 rows maximum (keeps UDTF runtime under 2 minutes)
  - ${nHint}`;
}

/**
 * Generate a human-readable clustering narrative from the UDTF result rows.
 *
 * Parses MODEL_METADATA (a JSON string present on every row, identical for
 * all rows in a run) and synthesises a markdown summary that
 * SegmentationArtifact.parseClusteringNarrative() can further enrich.
 */
function buildClusterNarrative(
  rows: Record<string, unknown>[],
  nClustersRequested: number,
): string {
  if (rows.length === 0) {
    return 'Clustering returned no results. The input query may have produced no records.';
  }

  // Parse MODEL_METADATA from the first row — it is identical for all rows.
  let meta: Record<string, unknown> = {};
  const rawMeta = rows[0]['MODEL_METADATA'] ?? rows[0]['model_metadata'];
  if (typeof rawMeta === 'string') {
    try { meta = JSON.parse(rawMeta) as Record<string, unknown>; } catch { /* ignore */ }
  }

  const algorithm      = (meta['algorithm'] as string | undefined) ?? 'Clustering';
  const nClustersUsed  = (meta['n_clusters'] as number | undefined) ?? nClustersRequested;
  const totalRecords   = (meta['n_records'] as number | undefined) ?? rows.length;
  const featureNames   = (meta['feature_names'] as string[] | undefined) ?? [];
  const silhouette     = meta['global_silhouette_avg'] as number | undefined;
  const confLabel      = meta['model_confidence_label'] as string | undefined;
  const dq             = meta['data_quality'] as Record<string, unknown> | undefined;
  const dropped        = (dq?.['dropped_features'] as string[] | undefined) ?? [];
  const droppedProt    = (dq?.['dropped_protected'] as string[] | undefined) ?? [];
  const clusterProfs   = meta['cluster_profiles'] as Record<string, Record<string, unknown>> | undefined;
  const clusterSizes   = meta['cluster_sizes'] as Record<string, number> | undefined;

  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push(
    `**${algorithm} clustering** identified **${nClustersUsed} segment${nClustersUsed !== 1 ? 's' : ''}** ` +
    `across **${totalRecords.toLocaleString()} records**` +
    (featureNames.length > 0
      ? ` using **${featureNames.length} feature${featureNames.length !== 1 ? 's' : ''}** ` +
        `(${featureNames.slice(0, 5).join(', ')}${featureNames.length > 5 ? ', …' : ''})`
      : '') +
    '.',
  );

  // ── Model quality ──────────────────────────────────────────────────────────
  if (silhouette !== undefined) {
    const qual = silhouette > 0.5 ? 'strong cluster separation'
               : silhouette > 0.2 ? 'moderate cluster separation'
               : 'weak cluster separation — interpret with caution';
    lines.push(`Model confidence: **${confLabel ?? 'N/A'}** (silhouette = ${silhouette.toFixed(3)} — ${qual}).`);
  }

  // ── Data quality warnings ──────────────────────────────────────────────────
  if (droppedProt.length > 0) {
    lines.push(
      `⚠️ User-requested feature${droppedProt.length > 1 ? 's' : ''} **${droppedProt.join(', ')}** ` +
      `dropped due to zero variance — check your data pipeline for these columns.`,
    );
  } else if (dropped.length > 0) {
    lines.push(`${dropped.length} feature${dropped.length > 1 ? 's' : ''} dropped due to zero variance.`);
  }

  // ── Per-segment summaries ──────────────────────────────────────────────────
  if (clusterProfs) {
    for (const [idStr, profile] of Object.entries(clusterProfs)) {
      const size      = clusterSizes?.[idStr] ?? 0;
      const pct       = totalRecords > 0 ? ((size / totalRecords) * 100).toFixed(1) : '?';
      const topDriver = profile['_TOP_DRIVER'] as string | undefined;
      const topZ      = profile['_TOP_DRIVER_ZSCORE'] as number | undefined;

      const driverStr = topDriver
        ? ` — top driver: **${topDriver}** (Z=${typeof topZ === 'number' ? topZ.toFixed(2) : '?'})`
        : '';
      lines.push(`- **Segment ${idStr}** (${size.toLocaleString()} records, ${pct}%)${driverStr}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// RouteDispatcher
// ---------------------------------------------------------------------------

export class RouteDispatcher {
  constructor(private context: ExecutionContext) {}

  async *dispatch(message: string, signal?: AbortSignal): AsyncGenerator<DispatchEvent> {
    const startMs = now();
    const reqId = startMs.toString(36);
    console.time(`TOTAL_REQUEST:${reqId}`);

    // -----------------------------------------------------------------------
    // 1. Classify intent
    // -----------------------------------------------------------------------
    yield {
      ...baseEvent('ROUTING', this.context),
      payload: { stage: 'classifying' },
    };

    const priorIntents = this.context.conversationHistory
      .filter((m) => m.role === 'assistant' && m.intent)
      .map((m) => m.intent as AgentIntent);

    console.time(`2_CLASSIFY_INTENT:${reqId}`);
    const classification = await classifyIntent({
      message,
      conversationContext: this.context.conversationHistory
        .slice(-6)
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n'),
      priorIntents,
    });
    console.timeEnd(`2_CLASSIFY_INTENT:${reqId}`);

    console.log(`[DISPATCHER] intent=${classification.intent} confidence=${classification.confidence} patterns=[${classification.matchedPatterns.join(', ')}]`);

    const intent: AgentIntent =
      classification.intent === 'UNKNOWN' ? 'ANALYST' : classification.intent;

    // Look up the route
    const route = AGENT_ROUTING_MAP[intent];
    const agentName = route.displayName;
    console.log(`[DISPATCHER] route: type=${route.type} agent=${route.cortexAgentName ?? 'n/a'} display="${agentName}"`);

    // -----------------------------------------------------------------------
    // 2. Routing event
    // -----------------------------------------------------------------------
    yield {
      ...baseEvent('ROUTING', this.context),
      intent,
      agentName,
      payload: {
        stage: 'routing',
        routingType: route.type,
        cortexAgentName: route.cortexAgentName,
        confidence: classification.confidence,
        matchedPatterns: classification.matchedPatterns,
      },
    };

    // -----------------------------------------------------------------------
    // 3. Rate limit check
    // -----------------------------------------------------------------------
    console.time(`3_RATE_LIMIT:${reqId}`);
    const rateLimitResult = await rateLimiter.checkAndConsume(this.context.userId);
    console.timeEnd(`3_RATE_LIMIT:${reqId}`);
    if (!rateLimitResult.allowed) {
      yield {
        ...baseEvent('ERROR', this.context),
        intent,
        agentName,
        error: rateLimitResult.reason ?? 'Rate limit exceeded.',
        payload: {
          retryAfterMs: rateLimitResult.retryAfterMs,
          remainingQueries: rateLimitResult.remainingQueries,
        },
      };
      return;
    }

    // -----------------------------------------------------------------------
    // 4. Cost estimate
    // -----------------------------------------------------------------------
    const costEstimate = costEstimator.estimate(intent, message, {});
    yield {
      ...baseEvent('ROUTING', this.context),
      intent,
      agentName,
      payload: {
        stage: 'cost_estimate',
        costEstimate,
        remainingCredits: rateLimitResult.remainingCredits,
      },
    };

    // -----------------------------------------------------------------------
    // 5. Build base AgentInput (used by PATH A and the pipeline path)
    // -----------------------------------------------------------------------
    const baseInput: AgentInput = {
      message,
      intent,
      sessionId: this.context.sessionId,
      userId: this.context.userId,
      semanticView: this.context.semanticView,
      conversationHistory: this.context.conversationHistory,
      userPreferences: this.context.userPreferences,
      extraContext: { abortSignal: signal, bypassCache: this.context.bypassCache ?? false },
    };

    // -----------------------------------------------------------------------
    // 6. Dispatch
    // -----------------------------------------------------------------------
    let result: AgentResult = { success: false, error: 'Dispatcher: no execution path matched', durationMs: 0, retryCount: 0 };

    try {
      // ─────────────────────────────────────────────────────────────────────
      // PATH C — pipeline (decompose into multiple steps)
      // ─────────────────────────────────────────────────────────────────────
      if (route.type === 'pipeline') {
        result = yield* this.dispatchPipeline(message, intent, agentName, baseInput, signal, startMs);
      }

      // ─────────────────────────────────────────────────────────────────────
      // PATH A — cortex_analyst
      // ─────────────────────────────────────────────────────────────────────
      else if (route.type === 'cortex_analyst') {
        yield { ...baseEvent('AGENT_START', this.context), intent, agentName };
        console.time(`5_ANALYST_AGENT:${reqId}`);
        result = await analystAgent.execute(baseInput);
        console.timeEnd(`5_ANALYST_AGENT:${reqId}`);
      }

      // ─────────────────────────────────────────────────────────────────────
      // PATH B-CLUSTER — CLUSTER* intents bypass the named agent entirely.
      //
      // Flow:
      //   1. Cortex Analyst → generate RECORD_ID + FEATURES input query
      //   2. Wrap in UDTF SELECT...TABLE()...OVER() (not CALL — SQL API
      //      cannot execute CALL for stored procedures)
      //   3. executeSQL() → raw UDTF rows
      //   4. Convert to { results: { headers, rows } } for SegmentationArtifact
      //   5. persistClusteringResults() [non-blocking]
      //   6. buildClusterNarrative() from MODEL_METADATA
      //
      // SRI_CLUSTERING_AGENT is NOT called for CLUSTER* intents.
      // It remains deployed for potential future use (e.g. non-cluster queries).
      // ─────────────────────────────────────────────────────────────────────
      else if (intent.startsWith('CLUSTER')) {
        result = yield* this.dispatchCluster(
          message, intent, agentName,
          route.cortexAgentName ?? 'CORTEX_TESTING.ML.SRI_CLUSTERING_AGENT',
          baseInput, signal, startMs,
        );
      }

      // ─────────────────────────────────────────────────────────────────────
      // PATH B-AGENT — other named Snowflake agents (FORECAST, CAUSAL, MTREE)
      // ─────────────────────────────────────────────────────────────────────
      else {
        const cortexRef = route.cortexAgentName!;

        yield {
          ...baseEvent('AGENT_START', this.context),
          intent,
          agentName,
          payload: { stage: 'calling_cortex_agent', cortexAgentName: cortexRef },
        };

        // Use getLastAnalystResult() to get both SQL and columns so that
        // enrichMessage can build a directive cohort constraint for FORECAST
        // and CAUSAL intents (not just a passive SQL code-block hint).
        const priorAnalyst = this.context.getLastAnalystResult?.();
        const lastSQL = priorAnalyst?.sql ?? this.context.getLastAnalystSQL?.();
        // Pull the last ANALYST narrative from conversation history to give
        // downstream agents (FORECAST, CAUSAL, MTREE) cohort context.
        const lastAnalystNarrative = [...this.context.conversationHistory]
          .reverse()
          .find((m) => m.role === 'assistant' && m.intent === 'ANALYST')
          ?.content;
        const isForecastIntent = /^FORECAST_/.test(intent) || intent === 'FORECAST_COMPARE' as string;
        // If a clustering run preceded this forecast, fetch per-cluster record IDs
        // from CLUSTERING_RESULTS and pass them as explicit IN lists.
        // This bypasses the CLUSTERING_RESULTS JOIN via Cortex Analyst (which can't
        // access that table since it's not in the semantic model).  With IN lists,
        // Cortex Analyst only touches semantic model tables and the filter is injected
        // directly into each cluster's query by the forecast agent.
        const clusterInfo = this.context.getLastClusterMeta?.();
        let clusterAssignments: Record<number, { label: string; recordIds: string[] }> | undefined;
        if (clusterInfo && isForecastIntent) {
          try {
            const assignSQL = `
              SELECT CLUSTER_ID, MAX(CLUSTER_LABEL) AS CLUSTER_LABEL, ARRAY_AGG(RECORD_ID) AS RECORD_IDS
              FROM CORTEX_TESTING.PUBLIC.CLUSTERING_RESULTS
              GROUP BY CLUSTER_ID
              ORDER BY CLUSTER_ID`;
            const assignResult = await executeSQL(assignSQL, SNOWFLAKE_ROLE, signal);
            if (assignResult.rowCount > 0) {
              clusterAssignments = {};
              for (const row of assignResult.rows) {
                const cid = Number(row['CLUSTER_ID'] ?? row['cluster_id']);
                const lbl = String(row['CLUSTER_LABEL'] ?? row['cluster_label'] ?? `Cluster ${cid}`);
                const ids = row['RECORD_IDS'] ?? row['record_ids'];
                const idArr: string[] = Array.isArray(ids)
                  ? ids.map(String)
                  : typeof ids === 'string'
                    ? JSON.parse(ids) as string[]
                    : [];
                clusterAssignments[cid] = { label: lbl, recordIds: idArr };
              }
              console.log(`[FORECAST] Fetched cluster assignments: ${Object.entries(clusterAssignments).map(([k, v]) => `Cluster ${k}: ${v.recordIds.length} records`).join(', ')}`);
            }
          } catch (err) {
            console.warn('[FORECAST] Could not fetch cluster assignments from CLUSTERING_RESULTS:', err instanceof Error ? err.message : String(err));
          }
        }
        const enriched = enrichMessage(message, intent, {
          priorSQL: lastSQL ?? undefined,
          priorColumns: priorAnalyst?.columns,
          priorNarrative: lastAnalystNarrative,
          clusterInfo: clusterInfo ?? undefined,
          clusterAssignments,
        });
        const agentMessages = this.buildAgentMessages(enriched);

        const lineageId = randomUUID();
        console.time(`5_CORTEX_AGENT:${reqId}`);
        const cortexResponse = await callCortexAgent(cortexRef, agentMessages, signal);
        console.timeEnd(`5_CORTEX_AGENT:${reqId}`);

        result = buildAgentResult(
          cortexRef,
          intent,
          agentName,
          cortexResponse.text,
          cortexResponse.sql,
          cortexResponse.data,
          cortexResponse.executionTimeMs,
          lineageId,
          cortexResponse.error,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const errorMsg = err instanceof Error ? err.message : String(err);
      yield {
        ...baseEvent('AGENT_ERROR', this.context),
        intent,
        agentName,
        error: errorMsg,
      };
      return;
    }

    // -----------------------------------------------------------------------
    // 7. Emit agent complete
    // -----------------------------------------------------------------------
    if (!result.success && result.error) {
      yield {
        ...baseEvent('AGENT_ERROR', this.context),
        intent,
        agentName,
        error: result.error,
      };
      return;
    }

    // Store successful result so subsequent turns can access it via context
    // helpers (getLastAnalystSQL, getLastAnalystData, etc.).
    if (result.success && result.artifact) {
      this.context.storeResult(`${intent}_${startMs}`, result);
    }

    // -----------------------------------------------------------------------
    // 8. Formatting
    // -----------------------------------------------------------------------
    yield {
      ...baseEvent('SYNTHESIS_START', this.context),
      intent,
      payload: { stage: 'formatting' },
    };

    console.time(`9_FORMAT:${reqId}`);
    const formatted = synthesizer.formatResult(result, intent);
    console.timeEnd(`9_FORMAT:${reqId}`);

    // -----------------------------------------------------------------------
    // 9. Record credit usage (non-blocking)
    // -----------------------------------------------------------------------
    rateLimiter.recordCreditUsage(this.context.userId, costEstimate.credits);

    // -----------------------------------------------------------------------
    // 10. Record lineage (non-blocking)
    // -----------------------------------------------------------------------
    lineageTracker.record({
      sessionId: this.context.sessionId,
      userId: this.context.userId,
      semanticViewId: this.context.semanticView.id,
      semanticViewName: this.context.semanticView.displayName,
      userQuestion: message,
      intent,
      agentName,
      executedSQL: result.artifact?.sql,
      rowCount: (() => {
        const d = result.artifact?.data as Record<string, unknown> | undefined;
        const rows = (d?.['results'] as { rows?: unknown[] } | undefined)?.rows;
        return Array.isArray(rows) ? rows.length : undefined;
      })(),
      executionTimeMs: now() - startMs,
      cacheStatus: result.artifact?.cacheStatus ?? 'miss',
      creditsConsumed: costEstimate.credits,
    });

    // -----------------------------------------------------------------------
    // 11. Build FormattedResponse
    // -----------------------------------------------------------------------
    const formattedResponse: FormattedResponse = synthesizer.toFormattedResponse(formatted, {
      sessionId: this.context.sessionId,
      intent,
      durationMs: now() - startMs,
      totalCostEstimate: {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: costEstimate.credits * 0.002,
        model: agentName,
      },
    });

    // -----------------------------------------------------------------------
    // 12. Add to conversation history
    // -----------------------------------------------------------------------
    // Store BOTH the user message and the assistant response so that
    // buildConversationHistory() always produces properly alternating
    // user/analyst pairs for Cortex Analyst.  Without the user message,
    // consecutive assistant turns produce [analyst, analyst, ...] which
    // causes Cortex Analyst 400: "Role must change after every message."
    this.context.addMessage({
      id: `user_${startMs}`,
      role: 'user',
      content: message,
      timestamp: startMs,
    });
    this.context.addMessage({
      id: formattedResponse.id,
      role: 'assistant',
      content: formattedResponse.narrative,
      timestamp: now(),
      intent,
      artifactId: result.artifact?.id,
    });

    // -----------------------------------------------------------------------
    // 13. Emit complete
    // -----------------------------------------------------------------------
    console.timeEnd(`TOTAL_REQUEST:${reqId}`);
    yield {
      ...baseEvent('SYNTHESIS_COMPLETE', this.context),
      intent,
      agentName,
      payload: { result: formattedResponse },
    };
  }

  // ---------------------------------------------------------------------------
  // PATH C — pipeline
  // ---------------------------------------------------------------------------

  private async *dispatchPipeline(
    message: string,
    intent: AgentIntent,
    agentName: string,
    baseInput: AgentInput,
    signal: AbortSignal | undefined,
    startMs: number,
  ): AsyncGenerator<DispatchEvent, AgentResult> {
    // Decompose the request into a pipeline definition.
    // The LLM classifier will have set intent='PIPELINE' for complex multi-step
    // requests; here we build a minimal pipeline that covers the common cases.
    const { decomposeIntoPipeline } = await import('../llm/anthropic');

    let pipelineDef: Awaited<ReturnType<typeof decomposeIntoPipeline>> | null = null;
    try {
      pipelineDef = await decomposeIntoPipeline({
        message,
        semanticViewDisplayName: this.context.semanticView.displayName,
        conversationContext: this.context.conversationHistory
          .slice(-4)
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n'),
      });
    } catch { /* fall back to default 2-step pipeline */ }

    const pipeline = pipelineDef ?? this.buildDefaultPipeline(message);

    const executor = new PipelineExecutor(this.context);

    for await (const pipelineEvent of executor.execute(pipeline, { nlQuery: message })) {
      if (pipelineEvent.type === 'step_start') {
        yield {
          ...baseEvent('AGENT_START', this.context),
          intent,
          agentName: pipelineEvent.agentName,
          payload: { stepId: pipelineEvent.stepId },
        };
      } else if (pipelineEvent.type === 'step_complete') {
        yield {
          ...baseEvent('AGENT_COMPLETE', this.context),
          intent,
          agentName,
          payload: { stepId: pipelineEvent.stepId, result: pipelineEvent.result },
        };
      } else if (pipelineEvent.type === 'step_error') {
        yield {
          ...baseEvent('AGENT_ERROR', this.context),
          intent,
          agentName,
          error: pipelineEvent.error,
          payload: { stepId: pipelineEvent.stepId },
        };
      } else if (pipelineEvent.type === 'synthesis') {
        yield {
          ...baseEvent('SYNTHESIS_COMPLETE', this.context),
          intent,
          payload: { narrative: pipelineEvent.narrative },
        };
      }
    }

    // Return a synthetic AgentResult from the last completed step
    const lastResult = [...this.context.intermediateResults.values()].pop();
    return lastResult ?? {
      success: false,
      error: 'Pipeline produced no results.',
      durationMs: Date.now() - startMs,
      retryCount: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // PATH B-CLUSTER — direct UDTF execution (bypasses named agent)
  // ---------------------------------------------------------------------------

  private async *dispatchCluster(
    message: string,
    intent: AgentIntent,
    agentName: string,
    cortexAgentRef: string,
    baseInput: AgentInput,
    signal: AbortSignal | undefined,
    startMs: number,
  ): AsyncGenerator<DispatchEvent, AgentResult> {
    const reqId = startMs.toString(36);
    const lineageId = randomUUID();

    yield {
      ...baseEvent('AGENT_START', this.context),
      intent,
      agentName,
      payload: { stage: 'clustering_direct', intent },
    };

    const nClusters = extractNClusters(message);
    console.log(
      `[CLUSTER] intent=${intent} n_clusters=${nClusters} ` +
      `(${nClusters === 0 ? 'auto-detect' : 'user-specified'})`,
    );

    // ── Step 1: RECORD_ID + FEATURES input query ────────────────────────────
    // PATH 1A — Prior ANALYST cohort exists: build the RECORD_ID + FEATURES
    //   SQL directly from the prior result (exact same WHERE / HAVING / LIMIT).
    //   This guarantees clustering runs on exactly the identified cohort without
    //   Cortex Analyst re-interpreting the population from a NL hint.
    // PATH 1B — No prior cohort: ask Cortex Analyst to generate the query.
    let inputQuery: string;

    const priorAnalyst = this.context.getLastAnalystResult?.();
    if (priorAnalyst?.sql && priorAnalyst.columns.length > 0) {
      console.log(`[CLUSTER] Prior cohort detected (${priorAnalyst.columns.length} cols). Building RECORD_ID+FEATURES from prior SQL directly.`);
      const cohortSQL = buildCohortClusterSQL(priorAnalyst.sql, priorAnalyst.columns);
      if (cohortSQL) {
        console.log(`[CLUSTER] Cohort SQL (first 300): ${cohortSQL.slice(0, 300)}`);
        inputQuery = cohortSQL;
      } else {
        console.log(`[CLUSTER] Could not derive cohort SQL — falling back to Cortex Analyst.`);
        // Fall through to PATH 1B below
        inputQuery = '';
      }
    } else {
      inputQuery = '';
    }

    if (!inputQuery) {
      // PATH 1B — Cortex Analyst generates the RECORD_ID + FEATURES query.
      // Pass conversation history so it understands follow-on context like
      // "cluster those physicians". Content must be Array<{type,text}>.
      const clusterHistory = this.context.conversationHistory
        .slice(-6)
        .map((m) => ({
          role: (m.role === 'assistant' ? 'analyst' : 'user') as 'user' | 'analyst',
          content: [{ type: 'text', text: m.content }],
        }));

      const analystQuestion = buildClusterInputQuestion(message, nClusters);
      console.time(`5a_CLUSTER_ANALYST:${reqId}`);
      let analystResp: Awaited<ReturnType<typeof callCortexAnalyst>>;
      try {
        analystResp = await callCortexAnalyst({
          question: analystQuestion,
          semanticView: baseInput.semanticView.fullyQualifiedName,
          conversationHistory: clusterHistory.length > 0 ? clusterHistory : undefined,
          signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CLUSTER] Cortex Analyst call failed: ${msg}`);
        return buildAgentResult('', intent, agentName, '', undefined, null, Date.now() - startMs, lineageId, `Cortex Analyst error: ${msg}`);
      }
      console.timeEnd(`5a_CLUSTER_ANALYST:${reqId}`);

      if (analystResp.error || !analystResp.sql) {
        const errMsg = analystResp.error ?? 'Cortex Analyst did not return SQL for the clustering input query';
        console.error(`[CLUSTER] Analyst error: ${errMsg}`);
        return buildAgentResult('', intent, agentName, '', undefined, null, Date.now() - startMs, lineageId, errMsg);
      }
      inputQuery = analystResp.sql.trim().replace(/;\s*$/, '');
    }

    console.log(`[CLUSTER] Input query (first 300): ${inputQuery.slice(0, 300)}`);

    // ── Step 2: Wrap input query in UDTF SELECT...TABLE()...OVER() ──────────
    const udtfSQL = buildClusterUDTFSQL(intent, inputQuery, nClusters);
    console.log(`[CLUSTER] UDTF SQL:\n${udtfSQL}`);

    // ── Step 3: Execute via Node.js driver (avoids REST API 45s async cutoff) ──
    console.time(`5b_CLUSTER_UDTF:${reqId}`);
    let udtfResult: Awaited<ReturnType<typeof executeClusteringSQL>>;
    try {
      udtfResult = await executeClusteringSQL(udtfSQL, signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CLUSTER] UDTF execution failed: ${msg}`);
      return buildAgentResult('', intent, agentName, '', undefined, null, Date.now() - startMs, lineageId, `Clustering UDTF error: ${msg}`);
    }
    console.timeEnd(`5b_CLUSTER_UDTF:${reqId}`);
    console.log(`[CLUSTER] UDTF returned ${udtfResult.rowCount} rows, columns: ${udtfResult.columns.join(', ')}`);

    if (udtfResult.rowCount === 0) {
      return buildAgentResult(
        '', intent, agentName,
        'Clustering returned no results. The source data query matched no records after applying the minimum group size filter.',
        udtfSQL, null, Date.now() - startMs, lineageId,
      );
    }

    // ── Step 4: Convert rows for SegmentationArtifact ───────────────────────
    // fromResultTable() in SegmentationArtifact expects:
    //   { results: { headers: string[], rows: (string|number|null)[][] } }
    // where rows are arrays indexed by column position (not Record<name,val>).
    const headers = udtfResult.columns;

    // MODEL_METADATA is a large JSON blob (~3 KB) repeated identically across
    // every row.  fromResultTable() only reads rows[0][ciModelMeta], so keeping
    // it in all 10 000 rows bloats the SSE payload to ~30 MB and risks the JSON
    // being truncated/corrupted on the client (causing feature_weighting to be
    // silently lost).  Strip it from every row after the first.
    const metaColIdx = headers.findIndex(
      (h) => h.toUpperCase() === 'MODEL_METADATA',
    );
    const tableRows = udtfResult.rows.map((r, rowIdx) =>
      headers.map((h, colIdx) => {
        // Null-out MODEL_METADATA for all rows except row 0
        if (colIdx === metaColIdx && rowIdx > 0) return null;
        const v = r[h];
        return v === undefined ? null : (v as string | number | null);
      }),
    );
    // Key must be `rows` — that is what fromResultTable() in SegmentationArtifact reads.
    const clusterData = { results: { headers, rows: tableRows } };

    // ── Step 5: Persist to CLUSTERING_RESULTS [non-blocking] ────────────────
    // Parse MODEL_METADATA from the first row to get N_SEGMENTS_USED and algorithm.
    const firstRow = udtfResult.rows[0] ?? {};
    const rawMeta = firstRow['MODEL_METADATA'] ?? firstRow['model_metadata'];
    let parsedMeta: Record<string, unknown> = {};
    if (typeof rawMeta === 'string') {
      try { parsedMeta = JSON.parse(rawMeta) as Record<string, unknown>; } catch { /* ignore */ }
    }
const nSegmentsUsed = (parsedMeta['n_clusters'] as number | undefined) ?? nClusters;
    const algorithmLabel = (() => {
      switch (intent) {
        case 'CLUSTER_GM':          return 'GM';
        case 'CLUSTER_KMEDOIDS':    return 'KMEDOIDS';
        case 'CLUSTER_HIERARCHICAL':return 'HIERARCHICAL';
        case 'CLUSTER_DBSCAN':      return 'DBSCAN';
        default:                    return 'KMEANS';
      }
    })();

    const runId = randomUUID();
    const runTimestamp = new Date().toISOString();

    persistClusteringResults(
      udtfResult.rows,
      {
        userId: this.context.userId,
        sessionId: this.context.sessionId,
        queryId: udtfResult.queryId || undefined,
        runId,
        runTimestamp,
        algorithm: algorithmLabel,
        nSegmentsRequested: nClusters,
        nSegmentsUsed,
      },
      signal,
    ).catch((err) => {
      console.error('[CLUSTER] Persistence failed (non-fatal):', err instanceof Error ? err.message : String(err));
    });

    // ── Step 5b: Store cluster metadata in context ───────────────────────────
    // Lets downstream FORECAST / CAUSAL steps know about cluster assignments
    // without re-running the UDTF. recordIdCol is extracted from the UDTF SQL
    // (CAST(col AS VARCHAR) AS RECORD_ID pattern).
    const idColMatch = udtfSQL.match(/CAST\((\w+)\s+AS\s+VARCHAR\)\s+AS\s+RECORD_ID/i);
    const recordIdCol = idColMatch?.[1];
    this.context.storeClusterMeta({
      nClusters: nSegmentsUsed,
      recordIdCol,
      algorithm: algorithmLabel,
      runId,
    });

    // ── Step 6: Build narrative from MODEL_METADATA ─────────────────────────
    const narrative = buildClusterNarrative(udtfResult.rows, nClusters);

    return buildAgentResult(
      cortexAgentRef,
      intent,
      agentName,
      narrative,
      udtfSQL,
      clusterData,
      Date.now() - startMs,
      lineageId,
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a default 2-step pipeline (ANALYST → FORECAST_AUTO) for the PIPELINE
   * intent when LLM decomposition is unavailable.
   */
  private buildDefaultPipeline(message: string) {
    const analystStepId = 'step_1_analyst';
    return {
      id: randomUUID(),
      name: 'Auto Pipeline',
      description: message.slice(0, 200),
      steps: [
        {
          stepId: analystStepId,
          intent: 'ANALYST' as AgentIntent,
          agentName: 'analyst',
          description: message.slice(0, 120),
          dependsOn: [],
          required: true,
        },
        {
          stepId: 'step_2_forecast',
          intent: 'FORECAST_AUTO' as AgentIntent,
          agentName: 'auto-forecast',
          description: 'Forecast the analyst results',
          dependsOn: [analystStepId],
          required: false,
        },
      ],
      parallelizable: false,
      createdAt: Date.now(),
      semanticViewDisplayName: this.context.semanticView.displayName,
    };
  }

  /**
   * Build the message array to send to a named Cortex Agent.
   * Includes the last few assistant turns as context.
   */
  private buildAgentMessages(
    currentMessage: string,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const history = this.context.conversationHistory.slice(-6);
    const agentMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const turn of history) {
      if (turn.role === 'user' || turn.role === 'assistant') {
        agentMessages.push({ role: turn.role, content: turn.content });
      }
    }

    agentMessages.push({ role: 'user', content: currentMessage });
    return agentMessages;
  }
}
