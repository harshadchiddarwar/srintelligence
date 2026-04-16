/**
 * Generic Snowflake Named Cortex Agent client.
 *
 * Calls any named Cortex Agent via:
 *   POST /api/v2/databases/{db}/schemas/{schema}/agents/{name}:run
 *
 * The caller passes a fully-qualified agent reference such as
 * "CORTEX_TESTING.ML.SRI_FORECAST_AGENT"; this module parses it and
 * constructs the correct endpoint URL.
 *
 * Named agents already contain all ML orchestration, tool definitions, and
 * semantic context configured in Snowflake — the web app only needs to pass
 * the conversation messages and receive the structured response.
 *
 * ## Client-side tool execution
 *
 * For clustering intents, the caller may pass `extraTools` containing the
 * `Execute_Clustering` tool spec.  When the agent's LLM generates a
 * `tool_use` block for `Execute_Clustering` with `client_side_execute: true`,
 * this module intercepts it, runs the CALL statement via `executeSQL()`, and
 * continues the conversation with the tool result — implementing a full
 * agentic loop without any extra round-trips from the caller.
 */

import { getAuthManager } from './auth';
import { executeSQL } from './sql-api';
import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(process.cwd(), 'cortex-agent-debug.log');
function appendLog(msg: string) {
  try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = `https://${process.env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com`;
export const SNOWFLAKE_ROLE = process.env.SNOWFLAKE_ROLE ?? 'APP_SVC_ROLE';

/** Maximum number of client-side tool round-trips before giving up */
const MAX_TOOL_ITERATIONS = 5;

// ---------------------------------------------------------------------------
// Execute_Clustering tool spec
//
// This replaces the 5 individual server-side clustering tools
// (KMeans_Cluster, Hierarchical_Cluster, DBSCAN_Cluster, KMedoids_Cluster,
// Cluster_GM) whose Snowflake-side definitions use invalid TABLE() UDTF syntax.
//
// By passing this spec in the API request body, the agent's LLM is offered a
// client-side alternative that constructs the complete CALL statement itself
// and lets the webapp execute it directly via executeSQL().
// ---------------------------------------------------------------------------

export const EXECUTE_CLUSTERING_TOOL = {
  // client_side_execute: true tells Snowflake to route this tool call BACK to the
  // webapp (as a response.tool_use event) rather than trying to execute it as a
  // Snowflake function.  Without this flag the agent treats Execute_Clustering as
  // a server-side Snowflake UDF/procedure, which fails with "Unknown UDF".
  client_side_execute: true,
  tool_spec: {
    type: 'generic' as const,
    name: 'Execute_Clustering',
    description: `Executes a clustering stored procedure on Snowflake by running a CALL statement.
The agent must construct the COMPLETE CALL statement as a string, including the fully qualified
procedure name, the dollar-quoted INPUT_QUERY, and all parameters.

Available procedures:
  CALL CORTEX_TESTING.ML.KMEANS_CLUSTER($$<query>$$, <n_segments>)
  CALL CORTEX_TESTING.ML.HIERARCHICAL_CLUSTER($$<query>$$, <n_segments>)
  CALL CORTEX_TESTING.ML.DBSCAN_CLUSTER($$<query>$$, <eps_value>, <min_samples>)
  CALL CORTEX_TESTING.ML.KMEDOIDS_CLUSTER($$<query>$$, <n_segments>)
  CALL CORTEX_TESTING.ML.CLUSTER_GM($$<query>$$, <n_segments>)

Rules:
  - sql_statement MUST start with "CALL CORTEX_TESTING.ML."
  - The INPUT_QUERY inside the CALL must be wrapped in $$ dollar-quote delimiters
  - The INPUT_QUERY must be a SELECT returning exactly 2 columns:
      RECORD_ID VARCHAR  — unique entity identifier
      FEATURES  VARIANT  — OBJECT_CONSTRUCT of numeric feature key-value pairs
  - Do NOT use SELECT...TABLE()...OVER() syntax — these are procedures, not functions
  - CALL is a standalone statement, not a subquery

Results are returned directly from the CALL result set and auto-persisted to
CORTEX_TESTING.PUBLIC.CLUSTERING_RESULTS.`,
    parameters: {
      type: 'object' as const,
      properties: {
        sql_statement: {
          type: 'string' as const,
          description: `The complete CALL statement. Must start with 'CALL CORTEX_TESTING.ML.' ` +
            `followed by the procedure name and parameters. ` +
            `Example: CALL CORTEX_TESTING.ML.KMEANS_CLUSTER($$SELECT physician_key::VARCHAR AS RECORD_ID, ` +
            `OBJECT_CONSTRUCT('TOTAL_CLAIMS', COUNT(claim_id)::FLOAT)::VARIANT AS FEATURES ` +
            `FROM CORTEX_TESTING.PUBLIC.RX_TABLE WHERE (ptd_final_claim = 1 OR ptd_final_claim IS NULL) ` +
            `AND claim_status_code = '1' GROUP BY physician_key HAVING COUNT(*) >= 5 LIMIT 5000$$, 2)`,
        },
      },
      required: ['sql_statement'],
    },
  },
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CortexAgentResponse {
  /** Human-readable narrative or answer text from the agent */
  text: string;
  /** SQL extracted from the agent response, if any */
  sql?: string;
  /**
   * Structured JSON data parsed from the agent response.
   * Named agents typically return a JSON payload in a code fence or as a tool
   * result; we attempt to parse it here and surface it directly.
   */
  data?: unknown;
  /** Wall-clock time for the complete round-trip in milliseconds */
  executionTimeMs: number;
  /** Set when the agent call failed */
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A pending client-side tool call detected in the SSE stream */
interface PendingToolCall {
  toolUseId: string;
  name: string;
  /** Raw input parameters from the LLM */
  input: Record<string, unknown>;
}

/** Extended ParsedPayload that may include a pending client-side tool call */
type ParsedPayload = Omit<CortexAgentResponse, 'executionTimeMs'> & {
  pendingToolCall?: PendingToolCall;
  /** Raw assistant content blocks (tool_use + text) for building follow-up messages */
  assistantContentBlocks?: Array<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse "DB.SCHEMA.AGENT_NAME" (case-insensitive, may be quoted) into parts.
 * Accepts 2-part ("SCHEMA.NAME") and 1-part ("NAME") forms as well.
 */
function parseAgentRef(ref: string): { db: string; schema: string; name: string } {
  // Strip surrounding quotes if present
  const clean = ref.replace(/"/g, '').trim();
  const parts = clean.split('.');
  if (parts.length === 3) {
    return { db: parts[0], schema: parts[1], name: parts[2] };
  }
  if (parts.length === 2) {
    return { db: 'CORTEX_TESTING', schema: parts[0], name: parts[1] };
  }
  // Single-part: assume default DB/schema
  return { db: 'CORTEX_TESTING', schema: 'ML', name: clean };
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Call a Snowflake Named Cortex Agent.
 *
 * Implements a full client-side tool execution loop: if the agent returns a
 * `tool_use` block for a client-side tool (e.g. `Execute_Clustering`), this
 * function executes it via `executeSQL()`, injects the tool result back into
 * the conversation, and calls the agent again — repeating up to
 * `MAX_TOOL_ITERATIONS` times.
 *
 * @param agentRef    Fully-qualified agent name, e.g. "CORTEX_TESTING.ML.SRI_FORECAST_AGENT"
 * @param messages    Conversation messages (role: 'user' | 'assistant', content: string)
 * @param signal      Optional AbortSignal for cancellation
 * @param extraTools  Additional tool specs to pass in the request body (e.g. Execute_Clustering)
 */
export async function callCortexAgent(
  agentRef: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal,
  extraTools?: Array<typeof EXECUTE_CLUSTERING_TOOL>,
): Promise<CortexAgentResponse> {
  const startMs = Date.now();
  const { db, schema, name } = parseAgentRef(agentRef);
  const agentUrl = `${BASE_URL}/api/v2/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/agents/${encodeURIComponent(name)}:run`;

  // Clear log file for this request
  try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
  appendLog(`>>> calling agent: ${agentRef}`);
  appendLog(`>>> url: ${agentUrl}`);
  appendLog(`>>> role: ${SNOWFLAKE_ROLE}`);
  appendLog(`>>> messages[0]: ${messages[0]?.content?.slice(0, 300)}`);
  appendLog(`>>> extraTools: ${extraTools?.map(t => t.tool_spec.name).join(', ') ?? 'none'}`);
  console.log(`[CORTEX_AGENT] >>> calling agent: ${agentRef}`);
  console.log(`[CORTEX_AGENT] >>> url: ${agentUrl}`);
  console.log(`[CORTEX_AGENT] >>> extraTools: ${extraTools?.map(t => t.tool_spec.name).join(', ') ?? 'none'}`);

  // Fetch auth headers once — reused across iterations
  let baseHeaders: Record<string, string>;
  try {
    baseHeaders = await getAuthManager().getAuthHeaders();
  } catch (authErr) {
    return { text: '', executionTimeMs: Date.now() - startMs, error: `Auth error: ${authErr instanceof Error ? authErr.message : String(authErr)}` };
  }
  const reqHeaders: Record<string, string> = {
    ...baseHeaders,
    'X-Snowflake-Role': SNOWFLAKE_ROLE,
    Accept: 'application/json, text/event-stream',
  };

  // Build initial Snowflake message array from plain string messages
  type SnowflakeMessage = { role: string; content: Array<Record<string, unknown>> };
  let conversationMessages: SnowflakeMessage[] = messages.map((m) => ({
    role: m.role,
    content: [{ type: 'text', text: m.content }],
  }));

  // Carry last cluster data across iterations so a successful CALL isn't lost
  let lastClusterData: unknown = undefined;
  let lastClusterSql: string | undefined = undefined;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    console.log(`[CORTEX_AGENT] iteration ${iteration + 1}/${MAX_TOOL_ITERATIONS}`);
    console.time(`[CORTEX_AGENT] ${name} fetch iter=${iteration + 1}`);

    const body: Record<string, unknown> = { messages: conversationMessages, stream: true };
    if (extraTools && extraTools.length > 0) {
      body['tools'] = extraTools;
    }

    let response: Response;
    try {
      response = await fetch(agentUrl, {
        method: 'POST',
        headers: reqHeaders,
        signal,
        body: JSON.stringify(body),
      });
    } catch (fetchErr) {
      const errMsg = `Network error calling ${name}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`;
      console.error(`[CORTEX_AGENT] NETWORK ERROR: ${errMsg}`);
      return { text: '', executionTimeMs: Date.now() - startMs, error: errMsg };
    }
    console.timeEnd(`[CORTEX_AGENT] ${name} fetch iter=${iteration + 1}`);

    console.log(`[CORTEX_AGENT] <<< HTTP ${response.status} content-type: ${response.headers.get('content-type')}`);

    if (!response.ok) {
      let errorMessage = `${name} request failed: HTTP ${response.status}`;
      try {
        const rawText = await response.text();
        console.error(`[CORTEX_AGENT] ERROR BODY: ${rawText.slice(0, 500)}`);
        try {
          const errJson = JSON.parse(rawText) as Record<string, unknown>;
          const msg =
            (errJson['message'] as string | undefined) ??
            ((errJson['error'] as Record<string, string> | undefined)?.['message']) ??
            rawText;
          if (msg) errorMessage = `${name} ${response.status}: ${msg}`;
        } catch {
          if (rawText.trim()) errorMessage = `${name} ${response.status}: ${rawText.trim()}`;
        }
      } catch { /* ignore */ }
      console.error(`[CORTEX_AGENT] FINAL ERROR: ${errorMessage}`);
      return { text: '', executionTimeMs: Date.now() - startMs, error: errorMessage };
    }

    // ── Parse response ─────────────────────────────────────────────────────
    const contentType = response.headers.get('content-type') ?? '';
    let parsed: ParsedPayload;

    if (contentType.includes('text/event-stream')) {
      console.log(`[CORTEX_AGENT] parsing SSE stream for ${name} (iter ${iteration + 1})`);
      console.time(`[CORTEX_AGENT] ${name} SSE iter=${iteration + 1}`);
      parsed = await parseSSEStream(response, name, signal);
      console.timeEnd(`[CORTEX_AGENT] ${name} SSE iter=${iteration + 1}`);
    } else {
      console.log(`[CORTEX_AGENT] parsing JSON for ${name} (iter ${iteration + 1})`);
      try {
        const rawBody = await response.text();
        console.log(`[CORTEX_AGENT] JSON body (first 500): ${rawBody.slice(0, 500)}`);
        const json = JSON.parse(rawBody) as Record<string, unknown>;
        parsed = extractFromJsonResponse(json, name);
      } catch (jsonErr) {
        const raw = await response.text().catch(() => '');
        console.error(`[CORTEX_AGENT] JSON parse error: ${jsonErr}`);
        return { text: raw, executionTimeMs: Date.now() - startMs };
      }
    }

    console.log(`[CORTEX_AGENT] parsed: text=${parsed.text.length} chars, sql=${!!parsed.sql}, data=${!!parsed.data}, pendingToolCall=${!!parsed.pendingToolCall}, error=${parsed.error}`);

    // ── No pending tool call → final response ────────────────────────────
    if (!parsed.pendingToolCall) {
      const finalData = parsed.data ?? lastClusterData;
      const finalSql = parsed.sql ?? lastClusterSql;
      return { ...parsed, data: finalData, sql: finalSql, executionTimeMs: Date.now() - startMs };
    }

    // ── Client-side tool call detected ──────────────────────────────────
    const { toolUseId, name: toolName, input, } = parsed.pendingToolCall;
    console.log(`[CORTEX_AGENT] Client-side tool call: ${toolName} id=${toolUseId}`);

    if (toolName !== 'Execute_Clustering') {
      // Unknown client-side tool — surface as error
      console.error(`[CORTEX_AGENT] Unknown client-side tool: ${toolName}`);
      return { text: parsed.text, executionTimeMs: Date.now() - startMs, error: `Unknown client-side tool: ${toolName}` };
    }

    // ── Execute Execute_Clustering ──────────────────────────────────────
    const sqlStatement = (input['sql_statement'] as string | undefined)?.trim() ?? '';
    console.log(`[CORTEX_AGENT] Execute_Clustering SQL (first 300): ${sqlStatement.slice(0, 300)}`);

    if (!sqlStatement.toUpperCase().startsWith('CALL CORTEX_TESTING.ML.')) {
      const errMsg = `Clustering tool received invalid SQL. Expected CALL statement, got: ${sqlStatement.slice(0, 80)}`;
      console.error(`[CORTEX_AGENT] ${errMsg}`);
      // Send error back to agent so it can recover
      const toolErrorResult = JSON.stringify({ error: errMsg });
      conversationMessages = appendToolResult(conversationMessages, parsed, toolUseId, toolName, input, toolErrorResult);
      continue;
    }

    let toolResultJson: string;
    try {
      console.time(`[CORTEX_AGENT] Execute_Clustering SQL`);
      // Pass SNOWFLAKE_ROLE so the SQL API executes under the same role as the
      // Cortex Agent (APP_SVC_ROLE by default).  Without this, the SQL API uses
      // the token's default role which may lack USAGE on CORTEX_TESTING.ML.*.
      const sqlResult = await executeSQL(sqlStatement, SNOWFLAKE_ROLE, signal);
      console.timeEnd(`[CORTEX_AGENT] Execute_Clustering SQL`);
      console.log(`[CORTEX_AGENT] Execute_Clustering returned ${sqlResult.rowCount} rows`);

      // Store result so it's available even if the agent's final text is bare
      lastClusterSql = sqlStatement;
      if (sqlResult.rowCount > 0) {
        const headers = sqlResult.columns;
        const rows = sqlResult.rows.map((r) =>
          headers.map((h) => {
            const v = r[h];
            return v === undefined ? null : (v as string | number | null);
          }),
        );
        lastClusterData = { results: { headers, rows } };
      }

      toolResultJson = JSON.stringify({
        rowCount: sqlResult.rowCount,
        columns: sqlResult.columns,
        // Send first 200 rows back to the agent for context; full set in lastClusterData
        rows: sqlResult.rows.slice(0, 200).map((r) =>
          sqlResult.columns.map((h) => r[h] ?? null),
        ),
      });
    } catch (execErr) {
      const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
      console.error(`[CORTEX_AGENT] Execute_Clustering failed: ${errMsg}`);
      toolResultJson = JSON.stringify({ error: errMsg });
    }

    // ── Build follow-up conversation with tool result ─────────────────────
    conversationMessages = appendToolResult(conversationMessages, parsed, toolUseId, toolName, input, toolResultJson);
  }

  // Exhausted iterations — return whatever we have
  console.warn(`[CORTEX_AGENT] Exhausted ${MAX_TOOL_ITERATIONS} tool iterations for ${name}`);
  return {
    text: 'Clustering analysis reached the maximum number of tool iterations.',
    data: lastClusterData,
    sql: lastClusterSql,
    executionTimeMs: Date.now() - startMs,
    error: 'Max tool iterations reached.',
  };
}

// ---------------------------------------------------------------------------
// Helper: append an assistant tool_use + tool_result to the conversation
// ---------------------------------------------------------------------------

function appendToolResult(
  conversationMessages: Array<{ role: string; content: Array<Record<string, unknown>> }>,
  parsed: ParsedPayload,
  toolUseId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResultJson: string,
): Array<{ role: string; content: Array<Record<string, unknown>> }> {
  // Assistant turn — include any text AND the tool_use block
  const assistantContent: Array<Record<string, unknown>> = [];
  if (parsed.text.trim()) {
    assistantContent.push({ type: 'text', text: parsed.text.trim() });
  }
  // Use accumulated assistant content blocks if available; otherwise synthesise one
  if (parsed.assistantContentBlocks && parsed.assistantContentBlocks.length > 0) {
    assistantContent.push(...parsed.assistantContentBlocks);
  } else {
    assistantContent.push({
      type: 'tool_use',
      id: toolUseId,
      name: toolName,
      input: toolInput,
    });
  }

  // Tool result — Snowflake mirrors Anthropic's format: user role with tool_result blocks
  const toolResultContent: Array<Record<string, unknown>> = [
    {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: toolResultJson,
    },
  ];

  return [
    ...conversationMessages,
    { role: 'assistant', content: assistantContent },
    { role: 'user', content: toolResultContent },
  ];
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

async function parseSSEStream(
  response: Response,
  agentName: string,
  signal?: AbortSignal,
): Promise<ParsedPayload> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: '', error: `No response body from ${agentName}` };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let extractedSql: string | undefined;
  let extractedData: unknown;
  let currentEventType = '';
  let rawEventCount = 0;

  // Accumulate Anthropic input_json_delta tool-input chunks per block index
  const toolInputAccum: Map<number, string> = new Map();

  // Track content_block_start metadata per block index so we can match
  // tool_use blocks with their accumulated inputs on content_block_stop
  const blockMeta: Map<number, { type: string; id?: string; name?: string }> = new Map();

  // Detected client-side tool call (Execute_Clustering)
  let pendingToolCall: PendingToolCall | undefined;
  // Raw assistant content blocks for the follow-up conversation
  const assistantContentBlocks: Array<Record<string, unknown>> = [];

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const raw of lines) {
        const line = raw.trimEnd();

        if (line === '') {
          currentEventType = '';
          continue;
        }
        if (line.startsWith('event:')) {
          currentEventType = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          const data = line.slice(5).trimStart();
          if (data === '[DONE]') {
            console.log(`[CORTEX_AGENT][SSE] [DONE] received after ${rawEventCount} events`);
            continue;
          }

          // Surface Snowflake agent-level errors (event: error)
          if (currentEventType === 'error') {
            try {
              const errJson = JSON.parse(data) as Record<string, unknown>;
              const errMsg = (errJson['message'] as string | undefined) ?? data;
              console.error(`[CORTEX_AGENT][SSE] ERROR event from ${agentName}: ${errMsg}`);
              appendLog(`ERROR event: ${errMsg}`);
              reader.releaseLock();
              return { text: '', error: `${agentName}: ${errMsg}` };
            } catch {
              reader.releaseLock();
              return { text: '', error: `${agentName} returned an error: ${data.slice(0, 200)}` };
            }
          }

          rawEventCount++;
          // Log first 20 raw events to diagnose format
          if (rawEventCount <= 20) {
            const msg = `[SSE] event#${rawEventCount} type="${currentEventType}" data=${data.slice(0, 400)}`;
            console.log(`[CORTEX_AGENT]${msg}`);
            appendLog(msg);
          }

          try {
            const json = JSON.parse(data) as Record<string, unknown>;

            // ── Text delta ────────────────────────────────────────────────
            const textChunk = extractTextChunk(json, currentEventType);
            if (textChunk) fullText += textChunk;

            // ── SQL from tool events ──────────────────────────────────────
            const sql = extractSqlFromEvent(json, currentEventType);
            if (sql && !extractedSql) extractedSql = sql;

            // ── content_block_start: track tool_use metadata ─────────────
            if (json['type'] === 'content_block_start') {
              const cb = json['content_block'] as Record<string, unknown> | undefined;
              const idx = (json['index'] as number | undefined) ?? 0;
              if (cb?.['type'] === 'tool_use') {
                blockMeta.set(idx, {
                  type: 'tool_use',
                  id: cb['id'] as string | undefined,
                  name: cb['name'] as string | undefined,
                });
                // If input is fully present in the start event (non-streaming)
                const input = cb['input'] as Record<string, unknown> | undefined;
                if (input && typeof input === 'object' && Object.keys(input).length > 0) {
                  const toolName = cb['name'] as string | undefined;
                  const toolId = cb['id'] as string | undefined;
                  if (toolName === 'Execute_Clustering' && toolId) {
                    pendingToolCall = { toolUseId: toolId, name: toolName, input };
                    assistantContentBlocks.push({ type: 'tool_use', id: toolId, name: toolName, input });
                  }
                }
              }
            }

            // ── input_json_delta: accumulate per block index ──────────────
            if (json['type'] === 'content_block_delta') {
              const delta = json['delta'] as Record<string, unknown> | undefined;
              if (delta?.['type'] === 'input_json_delta' && typeof delta['partial_json'] === 'string') {
                const idx = (json['index'] as number | undefined) ?? 0;
                toolInputAccum.set(idx, (toolInputAccum.get(idx) ?? '') + delta['partial_json']);
              }
            }

            // ── content_block_stop: finalise tool_use input ───────────────
            if (json['type'] === 'content_block_stop') {
              const idx = (json['index'] as number | undefined) ?? 0;
              const accumulated = toolInputAccum.get(idx);
              const meta = blockMeta.get(idx);
              toolInputAccum.delete(idx);

              if (accumulated && meta?.type === 'tool_use') {
                try {
                  const toolInput = JSON.parse(accumulated) as Record<string, unknown>;

                  if (meta.name === 'Execute_Clustering' && meta.id) {
                    // ── Client-side tool detected! ────────────────────────
                    pendingToolCall = {
                      toolUseId: meta.id,
                      name: meta.name,
                      input: toolInput,
                    };
                    assistantContentBlocks.push({
                      type: 'tool_use',
                      id: meta.id,
                      name: meta.name,
                      input: toolInput,
                    });
                    console.log(`[CORTEX_AGENT][SSE] Detected Execute_Clustering tool call id=${meta.id}`);
                    // Drain the rest of the stream so the connection is cleanly closed
                    // before we start the next HTTP request
                  } else if (!extractedSql) {
                    // For other tools: try to extract SQL from input
                    const candidate =
                      (toolInput['sql'] as string | undefined) ??
                      (toolInput['query'] as string | undefined) ??
                      (toolInput['statement'] as string | undefined);
                    if (typeof candidate === 'string' && candidate.trim().toUpperCase().startsWith('SELECT')) {
                      extractedSql = candidate.trim();
                    }
                  }
                } catch { /* partial JSON */ }
              }
            }

            // ── Detect Snowflake-style response.tool_use event ────────────
            // (alternative event format used by some Snowflake agent versions)
            {
              const evtType = (json['event'] as string | undefined) ?? currentEventType;
              if (evtType === 'response.tool_use' || json['type'] === 'response.tool_use') {
                const clientSide =
                  (json['client_side_execute'] as boolean | undefined) ??
                  ((json['data'] as Record<string, unknown> | undefined)?.['client_side_execute'] as boolean | undefined);
                const toolName =
                  (json['name'] as string | undefined) ??
                  ((json['data'] as Record<string, unknown> | undefined)?.['name'] as string | undefined);
                const toolId =
                  (json['tool_use_id'] as string | undefined) ??
                  ((json['data'] as Record<string, unknown> | undefined)?.['tool_use_id'] as string | undefined);
                const rawInput =
                  (json['input'] as Record<string, unknown> | undefined) ??
                  ((json['data'] as Record<string, unknown> | undefined)?.['input'] as Record<string, unknown> | undefined) ??
                  {};

                if (clientSide && toolName === 'Execute_Clustering' && toolId) {
                  pendingToolCall = { toolUseId: toolId, name: toolName, input: rawInput };
                  assistantContentBlocks.push({ type: 'tool_use', id: toolId, name: toolName, input: rawInput });
                  console.log(`[CORTEX_AGENT][SSE] Detected Execute_Clustering (response.tool_use) id=${toolId}`);
                }
              }
            }

            // ── Attempt to detect structured data payloads ────────────────
            if (!extractedData) {
              const candidate = extractStructuredData(json, currentEventType);
              if (candidate !== undefined) extractedData = candidate;
            }
          } catch {
            if (data && currentEventType === 'response.text.delta') {
              fullText += data;
            }
          }
        }
        // Lines starting with ':' are SSE comments — ignore
      }
    }
  } catch (streamErr) {
    if (!fullText && !pendingToolCall) {
      return {
        text: '',
        error: `Stream read error from ${agentName}: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`,
      };
    }
  } finally {
    reader.releaseLock();
  }

  // Fallback: try to extract SQL from markdown code fences in narrative text
  if (!extractedSql) {
    extractedSql = extractSqlFromText(fullText) ?? undefined;
  }

  // Fallback: try to parse JSON data block from narrative text
  if (!extractedData) {
    extractedData = extractJsonBlock(fullText);
  }

  const summary = `SSE complete: totalEvents=${rawEventCount} fullText=${fullText.length} chars, sql=${!!extractedSql}, data=${!!extractedData}, pendingToolCall=${!!pendingToolCall}`;
  console.log(`[CORTEX_AGENT] ${summary}`);
  appendLog(summary);
  if (fullText.length > 0) {
    console.log(`[CORTEX_AGENT] SSE fullText (first 300): ${fullText.slice(0, 300)}`);
    appendLog(`fullText: ${fullText.slice(0, 500)}`);
  }

  // Remove SQL/JSON code blocks from display text
  const displayText = fullText
    .replace(/```sql[\s\S]*?```/gi, '')
    .replace(/```json[\s\S]*?```/gi, '')
    .trim();

  return {
    text: displayText || fullText.trim(),
    sql: extractedSql,
    data: extractedData,
    pendingToolCall,
    assistantContentBlocks: assistantContentBlocks.length > 0 ? assistantContentBlocks : undefined,
  };
}

// ---------------------------------------------------------------------------
// Non-streaming JSON response extractor
// ---------------------------------------------------------------------------

function extractFromJsonResponse(json: Record<string, unknown>, _agentName: string): ParsedPayload {
  const message = json['message'] as Record<string, unknown> | undefined;
  const content = (message?.['content'] ?? json['content']) as
    | Array<Record<string, unknown>>
    | undefined;

  let text = '';
  let sql: string | undefined;
  let data: unknown;

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        text += block['text'];
      }
      if (block['type'] === 'sql' && typeof block['statement'] === 'string') {
        sql = block['statement'];
      }
      if (block['type'] === 'tool_result') {
        const d = extractStructuredData(block, '');
        if (d !== undefined && data === undefined) data = d;
      }
    }
  } else if (typeof json['text'] === 'string') {
    text = json['text'];
  }

  if (!sql && text) {
    sql = extractSqlFromText(text) ?? undefined;
  }
  if (!data) {
    data = extractJsonBlock(text);
  }

  const displayText = text
    .replace(/```sql[\s\S]*?```/gi, '')
    .replace(/```json[\s\S]*?```/gi, '')
    .trim();

  return { text: displayText || text, sql, data };
}

// ---------------------------------------------------------------------------
// Event-level chunk extractors (same patterns as analyst-api.ts)
// ---------------------------------------------------------------------------

function extractTextChunk(event: Record<string, unknown>, eventType: string): string {
  if (event['type'] === 'content_block_delta') {
    const delta = event['delta'] as Record<string, unknown> | undefined;
    if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
      return delta['text'];
    }
  }

  const embeddedEvent = (event['event'] as string | undefined) ?? eventType;

  if (embeddedEvent === 'response.text.delta' || embeddedEvent === 'message.delta') {
    const data = event['data'] as Record<string, unknown> | undefined;
    if (data) {
      if (typeof data['delta'] === 'string') return data['delta'];
      if (typeof data['text'] === 'string') return data['text'];
      const inner = data['delta'] as Record<string, unknown> | undefined;
      if (inner && typeof inner['text'] === 'string') return inner['text'];
    }
    if (typeof event['delta'] === 'string') return event['delta'];
    if (typeof event['text'] === 'string') return event['text'];
  }

  if (embeddedEvent === 'response.output_text.delta') {
    const data = event['data'] as Record<string, unknown> | undefined;
    if (typeof data?.['delta'] === 'string') return data['delta'];
    if (typeof event['delta'] === 'string') return event['delta'];
  }

  return '';
}

function extractSqlFromEvent(event: Record<string, unknown>, eventType: string): string | null {
  const embeddedEvent = (event['event'] as string | undefined) ?? eventType;

  if (embeddedEvent === 'response.tool_result') {
    const data = event['data'] as Record<string, unknown> | undefined;
    if (typeof data?.['sql'] === 'string') return data['sql'];
    if (typeof data?.['query'] === 'string') return data['query'];
    if (typeof data?.['statement'] === 'string') return data['statement'];
  }

  if (event['type'] === 'content_block_start') {
    const cb = event['content_block'] as Record<string, unknown> | undefined;
    if (cb?.['type'] === 'tool_use') {
      const input = cb['input'] as Record<string, unknown> | undefined;
      if (typeof input?.['sql'] === 'string') return input['sql'];
      if (typeof input?.['query'] === 'string') return input['query'];
    }
  }

  return null;
}

/**
 * Attempt to extract a structured data payload from a tool-result event.
 * Named agents may return JSON objects (forecast rows, cluster profiles, etc.)
 * inside tool results.
 */
function extractStructuredData(event: Record<string, unknown>, _eventType: string): unknown {
  // Anthropic tool_result block
  if (event['type'] === 'tool_result') {
    const content = event['content'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b['type'] === 'text' && typeof b['text'] === 'string') {
          const parsed = tryParseJson(b['text']);
          if (parsed !== undefined) return parsed;
        }
      }
    }
    const result = event['result'] ?? event['output'];
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const r = result as Record<string, unknown>;
      // Look for domain-specific keys that indicate a structured payload
      if (
        'drivers' in r || 'segments' in r || 'historical' in r ||
        'forecast' in r || 'models' in r || 'tests' in r || 'sections' in r
      ) {
        return result;
      }
    }
    if (Array.isArray(result) && result.length > 0) return result;
  }

  // Snowflake message_delta with tool_result content
  if (event['type'] === 'message_delta') {
    const content = event['content'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block['type'] === 'tool_result') {
          const d = extractStructuredData(block, '');
          if (d !== undefined) return d;
        }
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Text-based extractors
// ---------------------------------------------------------------------------

function extractSqlFromText(text: string): string | null {
  const sqlBlock = text.match(/```sql\s*([\s\S]+?)\s*```/i);
  if (sqlBlock?.[1]) return sqlBlock[1].trim();

  const selectBlock = text.match(/```\s*(SELECT[\s\S]+?)\s*```/i);
  if (selectBlock?.[1]) return selectBlock[1].trim();

  return null;
}

function extractJsonBlock(text: string): unknown {
  const jsonBlock = text.match(/```json\s*([\s\S]+?)\s*```/i);
  if (jsonBlock?.[1]) {
    return tryParseJson(jsonBlock[1].trim());
  }
  return undefined;
}

function tryParseJson(text: string): unknown {
  try {
    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return JSON.parse(trimmed);
    }
  } catch { /* not valid JSON */ }
  return undefined;
}
