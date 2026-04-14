/**
 * Snowflake Cortex Analyst client — calls the direct Cortex Analyst REST API.
 *
 * Endpoint: POST /api/v2/cortex/analyst/message
 *
 * Passes the semantic_view (fully-qualified view name) and conversation
 * messages. Returns SQL + brief text synchronously — no SSE stream needed.
 * SQL is executed separately by analyst-agent.ts via executeSQL().
 */

import { authManager } from './auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = `https://${process.env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com`;
const CORTEX_ANALYST_URL = `${BASE_URL}/api/v2/cortex/analyst/message`;
const SNOWFLAKE_ROLE = process.env.SNOWFLAKE_ROLE ?? 'APP_SVC_ROLE';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AnalystResponse {
  text: string;
  sql?: string;
  /**
   * Structured data extracted from the agent's tool-result events, if present.
   * Named agents may return query results directly as JSON rather than (or in
   * addition to) returning a SQL string.  When this field is set and `sql` is
   * absent, `analyst-agent.ts` will use it as the primary data payload.
   */
  data?: unknown;
  suggestions: string[];
  error?: string;
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Internal message shapes
// ---------------------------------------------------------------------------

// Cortex Analyst REST API uses role 'user' | 'analyst'
interface AnalystMessage {
  role: 'user' | 'analyst';
  content: Array<{ type: string; text?: string; statement?: string; suggestions?: string[] }>;
}

// ---------------------------------------------------------------------------
// Public function (signature kept identical so callers need no changes)
// ---------------------------------------------------------------------------

/**
 * Call SRI_ANALYST_AGENT on Snowflake.
 *
 * @param params.question            - The natural language question.
 * @param params.semanticView        - Kept for API compatibility; the named
 *                                     agent already knows its semantic view.
 * @param params.conversationHistory - Optional prior conversation turns.
 */
export async function callCortexAnalyst(params: {
  question: string;
  semanticView: string;
  conversationHistory?: AnalystMessage[];
  signal?: AbortSignal;
}): Promise<AnalystResponse> {
  const { question, semanticView, conversationHistory = [], signal } = params;

  if (!semanticView) {
    return { text: '', suggestions: [], error: 'No semantic view configured for this session.' };
  }

  const baseHeaders = await authManager.getAuthHeaders();
  const headers: Record<string, string> = {
    ...baseHeaders,
    'X-Snowflake-Role': SNOWFLAKE_ROLE,
    Accept: 'application/json',
  };

  // Cortex Analyst REST API uses role 'user' | 'analyst' — pass as-is
  const userTurn: AnalystMessage = {
    role: 'user',
    content: [{ type: 'text', text: question }],
  };
  const messages: AnalystMessage[] = [...conversationHistory, userTurn];

  let response: Response;
  try {
    response = await fetch(CORTEX_ANALYST_URL, {
      method: 'POST',
      headers,
      signal,
      // Stage-based YAML models use `semantic_model_file` (@DB.SCHEMA.STAGE/file.yaml).
      // Named Snowflake semantic views use `semantic_view` (DB.SCHEMA.VIEW).
      body: JSON.stringify({
        messages,
        ...(semanticView.startsWith('@')
          ? { semantic_model_file: semanticView }
          : { semantic_view: semanticView }),
      }),
    });
  } catch (fetchErr) {
    return {
      text: '',
      suggestions: [],
      error: `Network error calling Cortex Analyst: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
    };
  }

  if (!response.ok) {
    let errorMessage = `Cortex Analyst request failed: HTTP ${response.status}`;
    try {
      const rawText = await response.text();
      try {
        const errJson = JSON.parse(rawText) as Record<string, unknown>;
        const msg =
          (errJson['message'] as string | undefined) ??
          ((errJson['error'] as Record<string, string> | undefined)?.['message']) ??
          rawText;
        if (msg) errorMessage = `Cortex Analyst ${response.status}: ${msg}`;
      } catch {
        if (rawText.trim()) errorMessage = `Cortex Analyst ${response.status}: ${rawText.trim()}`;
      }
    } catch { /* keep status-based message */ }
    return { text: '', suggestions: [], error: errorMessage };
  }

  try {
    const json = (await response.json()) as Record<string, unknown>;
    return extractFromJsonResponse(json);
  } catch {
    const raw = await response.text().catch(() => '');
    return { text: raw, suggestions: [] };
  }
}

// ---------------------------------------------------------------------------
// SSE stream parser
// @deprecated — retained for rollback only. callCortexAnalyst() now uses the
// direct Cortex Analyst REST API which returns plain JSON, not SSE.
// ---------------------------------------------------------------------------

async function parseSSEStream(response: Response, signal?: AbortSignal): Promise<AnalystResponse> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: '', suggestions: [], error: 'No response body from SRI_ANALYST_AGENT' };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let extractedSql: string | undefined;
  let extractedData: unknown;
  const suggestions: string[] = [];

  // Track current SSE event (multi-line SSE: event: + data:)
  let currentEventType = '';

  // Accumulate Anthropic input_json_delta chunks per content block index.
  // When the agent calls a tool (e.g. Cortex Analyst), the tool input arrives
  // as a series of input_json_delta events; the complete JSON may contain the SQL.
  const toolInputAccum: Map<number, string> = new Map();

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on newlines; keep the last (potentially incomplete) segment
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const raw of lines) {
        const line = raw.trimEnd(); // preserve leading spaces (SSE allows them)

        // Blank line = end of SSE event block
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
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data) as Record<string, unknown>;

            // ── DEBUG: log every unique event type ────────────────────────
            const evtType = (json['type'] as string | undefined) ?? `event:${currentEventType}`;
            console.log('[SRI_ANALYST_AGENT SSE]', evtType, JSON.stringify(json).slice(0, 300));

            const chunk = extractTextChunk(json, currentEventType);
            if (chunk) fullText += chunk;

            const sql = extractSqlFromEvent(json, currentEventType);
            if (sql && !extractedSql) extractedSql = sql;

            // ── Structured data from tool results ────────────────────────
            if (!extractedData) {
              const candidate = extractStructuredData(json, currentEventType);
              if (candidate !== undefined) extractedData = candidate;
            }

            // ── Accumulate tool input_json_delta chunks ──────────────────
            // Anthropic streaming sends tool inputs piecemeal via
            // content_block_delta events with delta.type === 'input_json_delta'.
            // We reassemble per block index and try to extract SQL when the
            // block stops (content_block_stop).
            if (json['type'] === 'content_block_delta') {
              const delta = json['delta'] as Record<string, unknown> | undefined;
              if (delta?.['type'] === 'input_json_delta' && typeof delta['partial_json'] === 'string') {
                const idx = (json['index'] as number | undefined) ?? 0;
                toolInputAccum.set(idx, (toolInputAccum.get(idx) ?? '') + delta['partial_json']);
              }
            }

            if (json['type'] === 'content_block_stop' && !extractedSql) {
              const idx = (json['index'] as number | undefined) ?? 0;
              const accumulated = toolInputAccum.get(idx);
              if (accumulated) {
                toolInputAccum.delete(idx);
                try {
                  const toolInput = JSON.parse(accumulated) as Record<string, unknown>;
                  const candidate =
                    (toolInput['sql'] as string | undefined) ??
                    (toolInput['query'] as string | undefined) ??
                    (toolInput['statement'] as string | undefined);
                  if (typeof candidate === 'string' && candidate.trim().toUpperCase().startsWith('SELECT')) {
                    extractedSql = candidate.trim();
                  } else {
                    // Try extracting from any string field that looks like SQL
                    for (const v of Object.values(toolInput)) {
                      if (typeof v === 'string') {
                        const found = extractSqlFromText(v);
                        if (found) { extractedSql = found; break; }
                      }
                    }
                  }
                } catch {
                  // Partial JSON — not yet complete
                }
              }
            }

            // Collect suggestions
            const sug = extractSuggestions(json);
            if (sug.length) suggestions.push(...sug);
          } catch {
            // Not JSON — could be a plain-text delta, append as-is
            if (data && currentEventType === 'response.text.delta') {
              fullText += data;
            }
          }
        }
        // Lines starting with ':' are SSE comments — ignore
      }
    }
  } catch (streamErr) {
    // Partial result is better than nothing
    if (!fullText) {
      return {
        text: '',
        suggestions: [],
        error: `Stream read error: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`,
      };
    }
  } finally {
    reader.releaseLock();
  }

  // ── DEBUG: log what we have after the SSE loop ──────────────────────────
  console.log('[SRI_ANALYST_AGENT] fullText length:', fullText.length);
  console.log('[SRI_ANALYST_AGENT] fullText preview:', fullText.slice(0, 500));
  console.log('[SRI_ANALYST_AGENT] extractedSql before text-fallback:', extractedSql);

  // Attempt to pull SQL from markdown code blocks in the final text
  if (!extractedSql) {
    extractedSql = extractSqlFromText(fullText) ?? undefined;
  }

  console.log('[SRI_ANALYST_AGENT] extractedSql after text-fallback:', extractedSql?.slice(0, 200));

  // Final fallback: try to extract structured JSON from any ```json block in the
  // accumulated text (named agents sometimes surface result data this way).
  if (!extractedData) {
    extractedData = extractJsonBlock(fullText);
  }

  // Last-resort fallback: parse a markdown table from the narrative text.
  // Snowflake Cortex Agents often embed results as a markdown table when they
  // cannot return structured JSON (e.g. when the chart block was stripped).
  if (!extractedData && !extractedSql) {
    extractedData = extractMarkdownTable(fullText);
  }

  console.log('[SRI_ANALYST_AGENT] extractedData:', extractedData ? JSON.stringify(extractedData).slice(0, 200) : 'none');

  // Remove SQL/JSON code blocks from the display narrative
  const displayText = fullText
    .replace(/```sql[\s\S]*?```/gi, '')
    .replace(/```json[\s\S]*?```/gi, '')
    .trim();

  return {
    text: displayText || fullText.trim(),
    sql: extractedSql,
    data: extractedData,
    suggestions,
  };
}

// ---------------------------------------------------------------------------
// Non-streaming JSON response extractor
// ---------------------------------------------------------------------------

function extractFromJsonResponse(json: Record<string, unknown>): AnalystResponse {
  // Cortex Analyst REST API response shape:
  // { message: { role: 'analyst', content: [{ type: 'sql'|'text'|'suggestions', ... }] }, request_id }
  const message = json['message'] as Record<string, unknown> | undefined;
  const content = (message?.['content'] ?? json['content']) as
    | Array<Record<string, unknown>>
    | undefined;

  let text = '';
  let sql: string | undefined;
  const suggestions: string[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        text += block['text'];
      }
      if (block['type'] === 'sql' && typeof block['statement'] === 'string') {
        sql = block['statement'];
      }
      if (block['type'] === 'suggestions' && Array.isArray(block['suggestions'])) {
        suggestions.push(...(block['suggestions'] as string[]));
      }
    }
  } else if (typeof json['text'] === 'string') {
    text = json['text'];
  }

  if (!sql && text) {
    sql = extractSqlFromText(text) ?? undefined;
  }

  const data = extractJsonBlock(text);

  const displayText = text
    .replace(/```sql[\s\S]*?```/gi, '')
    .replace(/```json[\s\S]*?```/gi, '')
    .trim();

  return { text: displayText || text, sql, data, suggestions };
}

// ---------------------------------------------------------------------------
// Per-event chunk extractors
// ---------------------------------------------------------------------------

/**
 * Return the text delta from a parsed SSE data JSON object.
 * Handles both Anthropic-style (content_block_delta) and Snowflake-style
 * (response.text.delta / response.output_text / plain text fields).
 */
function extractTextChunk(event: Record<string, unknown>, eventType: string): string {
  // ── Anthropic streaming format ──────────────────────────────────────────
  // {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
  if (event['type'] === 'content_block_delta') {
    const delta = event['delta'] as Record<string, unknown> | undefined;
    if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
      return delta['text'];
    }
  }

  // ── Snowflake event-in-JSON format ─────────────────────────────────────
  // {"event":"response.text.delta","data":{"delta":"..."|"text":"..."}}
  const embeddedEvent = (event['event'] as string | undefined) ?? eventType;

  if (embeddedEvent === 'response.text.delta' || embeddedEvent === 'message.delta') {
    const data = event['data'] as Record<string, unknown> | undefined;
    if (data) {
      if (typeof data['delta'] === 'string') return data['delta'];
      if (typeof data['text'] === 'string') return data['text'];
      // Nested: {"delta":{"text":"..."}}
      const inner = data['delta'] as Record<string, unknown> | undefined;
      if (inner && typeof inner['text'] === 'string') return inner['text'];
    }
    // Or directly on the event object
    if (typeof event['delta'] === 'string') return event['delta'];
    if (typeof event['text'] === 'string') return event['text'];
  }

  // Snowflake "output_text" events
  if (embeddedEvent === 'response.output_text.delta') {
    const data = event['data'] as Record<string, unknown> | undefined;
    if (typeof data?.['delta'] === 'string') return data['delta'];
    if (typeof event['delta'] === 'string') return event['delta'];
  }

  return '';
}

/**
 * Try to extract SQL from tool-result events.
 */
function extractSqlFromEvent(
  event: Record<string, unknown>,
  eventType: string,
): string | null {
  const embeddedEvent = (event['event'] as string | undefined) ?? eventType;

  // ── Helper: scan a content-block array for SQL ───────────────────────────
  function scanContentBlocks(blocks: Array<Record<string, unknown>>): string | null {
    for (const b of blocks) {
      if (b['type'] === 'sql' && typeof b['statement'] === 'string') return b['statement'];
      if (b['type'] === 'text' && typeof b['text'] === 'string') {
        const s = extractSqlFromText(b['text']);
        if (s) return s;
      }
    }
    return null;
  }

  // ── Helper: scan any object/string for SQL ────────────────────────────────
  function scanResult(result: Record<string, unknown> | string): string | null {
    if (typeof result === 'string') return extractSqlFromText(result);
    if (typeof result['sql'] === 'string') return result['sql'];
    if (typeof result['query'] === 'string') return result['query'];
    if (typeof result['statement'] === 'string') return result['statement'];
    const contentArr = result['content'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(contentArr)) return scanContentBlocks(contentArr);
    return null;
  }

  // ── SSE event: tool_result OR response.tool_result ────────────────────────
  // Covers: event['event']='response.tool_result', eventType='tool_result',
  //         and event['type']='tool_result' (Anthropic format)
  const isToolResult =
    embeddedEvent === 'response.tool_result' ||
    embeddedEvent === 'tool_result' ||
    event['type'] === 'tool_result';

  if (isToolResult) {
    // The payload may arrive directly on event, or nested under event['data']
    const payloads: Array<Record<string, unknown>> = [event];
    const evtData = event['data'] as Record<string, unknown> | undefined;
    if (evtData) payloads.push(evtData);

    for (const payload of payloads) {
      if (typeof payload['sql'] === 'string') return payload['sql'];
      if (typeof payload['query'] === 'string') return payload['query'];
      if (typeof payload['statement'] === 'string') return payload['statement'];

      const content = payload['content'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        const s = scanContentBlocks(content);
        if (s) return s;
      }

      const result = payload['result'] ?? payload['output'];
      if (typeof result === 'string' || (result && typeof result === 'object')) {
        const s = scanResult(result as Record<string, unknown> | string);
        if (s) return s;
      }
    }
  }

  // ── Anthropic content_block_start with tool_use ───────────────────────────
  if (event['type'] === 'content_block_start') {
    const cb = event['content_block'] as Record<string, unknown> | undefined;
    if (cb?.['type'] === 'tool_use') {
      const input = cb['input'] as Record<string, unknown> | undefined;
      if (typeof input?.['sql'] === 'string') return input['sql'];
      if (typeof input?.['query'] === 'string') return input['query'];
    }
    // content_block_start can also carry a tool_result block (Snowflake named agents)
    if (cb?.['type'] === 'tool_result') {
      const content = cb['content'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        const s = scanContentBlocks(content);
        if (s) return s;
      }
    }
  }

  // ── Anthropic tool_use input (non-streaming, full input present) ──────────
  if (event['type'] === 'tool_use') {
    const input = event['input'] as Record<string, unknown> | undefined;
    if (typeof input?.['sql'] === 'string') return input['sql'];
    if (typeof input?.['query'] === 'string') return input['query'];
  }

  // ── message_delta carrying nested tool_result blocks ─────────────────────
  if (event['type'] === 'message_delta') {
    const content = event['content'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block['type'] === 'tool_result') {
          const c = block['content'] as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(c)) {
            const s = scanContentBlocks(c);
            if (s) return s;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Extract follow-up suggestions from the event if any.
 */
function extractSuggestions(event: Record<string, unknown>): string[] {
  const data = event['data'] as Record<string, unknown> | undefined;
  const suggestions = (data?.['suggestions'] ?? event['suggestions']) as
    | string[]
    | undefined;
  return Array.isArray(suggestions) ? suggestions : [];
}

// ---------------------------------------------------------------------------
// Structured data extraction (mirrors cortex-agent-api.ts)
// ---------------------------------------------------------------------------

/**
 * Attempt to extract a structured data payload from a tool-result SSE event.
 * Named Cortex Agents may return tabular result data inside tool results rather
 * than (or in addition to) returning a SQL string.
 *
 * @param event       Parsed JSON from a `data:` SSE line
 * @param eventType   Value of the preceding `event:` SSE line (may be empty)
 */
function extractStructuredData(event: Record<string, unknown>, eventType = ''): unknown {
  const embeddedEvent = (event['event'] as string | undefined) ?? eventType;

  // ── Snowflake event:response.table — full result set with column metadata ──
  if (embeddedEvent === 'response.table') {
    const resultSet = event['result_set'] as Record<string, unknown> | undefined;
    if (resultSet) {
      const extracted = extractResultSet(resultSet);
      if (extracted) return extracted;
    }
  }

  // ── Snowflake event:response.chart — Vega-Lite spec with embedded values ───
  // Use the chart's data.values array (already column-filtered and named).
  if (embeddedEvent === 'response.chart') {
    const chartSpecStr = event['chart_spec'] as string | undefined;
    if (typeof chartSpecStr === 'string') {
      try {
        const spec = JSON.parse(chartSpecStr) as Record<string, unknown>;
        const values = (spec['data'] as Record<string, unknown> | undefined)?.['values'];
        if (Array.isArray(values) && values.length > 0) {
          const headers = Object.keys(values[0] as Record<string, unknown>);
          const rows = (values as Record<string, unknown>[]).map((obj) =>
            headers.map((h) => {
              const v = obj[h];
              return typeof v === 'number' ? v : String(v ?? '');
            }) as (string | number)[]
          );
          return { results: { headers, rows } };
        }
      } catch { /* skip malformed spec */ }
    }
  }

  // ── cortex_analyst_text_to_sql tool result (type field = event name) ───────
  // Arrives as: {"type":"cortex_analyst_text_to_sql","content":[{"json":{"result_set":...}}]}
  if (event['type'] === 'cortex_analyst_text_to_sql') {
    const content = event['content'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        const inner = block['json'] as Record<string, unknown> | undefined;
        if (inner) {
          const resultSet = inner['result_set'] as Record<string, unknown> | undefined;
          if (resultSet) {
            const extracted = extractResultSet(resultSet);
            if (extracted) return extracted;
          }
        }
      }
    }
  }

  // ── Determine whether this event represents a tool result ─────────────────
  const isToolResult =
    event['type'] === 'tool_result' ||
    embeddedEvent === 'tool_result' ||
    embeddedEvent === 'response.tool_result';

  if (isToolResult) {
    const payloads: Array<Record<string, unknown>> = [event];
    const evtData = event['data'] as Record<string, unknown> | undefined;
    if (evtData) payloads.push(evtData);

    for (const payload of payloads) {
      // Direct content-block array (Cortex Analyst: [{ type:'sql', statement },{ type:'text' }])
      const content = payload['content'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b['type'] === 'text' && typeof b['text'] === 'string') {
            const parsed = tryParseJson(b['text']);
            if (parsed !== undefined) return parsed;
          }
        }
      }

      // result / output field
      const result = payload['result'] ?? payload['output'];
      if (Array.isArray(result) && result.length > 0) return result;
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        const r = result as Record<string, unknown>;
        if (
          'rows' in r || 'headers' in r || 'results' in r ||
          'data' in r || 'drivers' in r || 'segments' in r ||
          'historical' in r || 'forecast' in r
        ) {
          return result;
        }
      }
    }
  }

  // ── Anthropic content_block_start with tool_result content_block ──────────
  if (event['type'] === 'content_block_start') {
    const cb = event['content_block'] as Record<string, unknown> | undefined;
    if (cb?.['type'] === 'tool_result') {
      const content = cb['content'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b['type'] === 'text' && typeof b['text'] === 'string') {
            const parsed = tryParseJson(b['text']);
            if (parsed !== undefined) return parsed;
          }
        }
      }
    }
  }

  // ── message_delta carrying nested tool_result blocks ─────────────────────
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
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      return JSON.parse(trimmed);
    }
  } catch { /* not valid JSON */ }
  return undefined;
}

// ---------------------------------------------------------------------------
// SQL extraction from markdown text
// ---------------------------------------------------------------------------

function extractSqlFromText(text: string): string | null {
  // ```sql ... ```
  const sqlBlock = text.match(/```sql\s*([\s\S]+?)\s*```/i);
  if (sqlBlock?.[1]) return sqlBlock[1].trim();

  // ``` SELECT ... ``` (unlabelled code block starting with a SELECT keyword)
  const selectBlock = text.match(/```\s*(SELECT[\s\S]+?)\s*```/i);
  if (selectBlock?.[1]) return selectBlock[1].trim();

  // Bare SELECT statement in plain text (no code block)
  const bareSelect = text.match(/\b(SELECT\s[\s\S]+?;?\s*)(?=\n\n|\n[A-Z]|$)/i);
  if (bareSelect?.[1]?.trim().toUpperCase().startsWith('SELECT')) {
    return bareSelect[1].trim();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Snowflake result_set extractor
// ---------------------------------------------------------------------------

/**
 * Convert a Snowflake result_set object (from cortex_analyst_text_to_sql or
 * event:response.table) into the { results: { headers, rows } } shape used
 * throughout the app.
 *
 * Expected shape:
 *   result_set.data                  — (string|null)[][]
 *   result_set.resultSetMetaData.rowType[].name — column names
 */
function extractResultSet(
  resultSet: Record<string, unknown>,
): { results: { headers: string[]; rows: (string | number)[][] } } | undefined {
  const data = resultSet['data'] as (string | null)[][] | undefined;
  if (!Array.isArray(data) || data.length === 0) return undefined;

  // Derive headers from resultSetMetaData.rowType if present
  const metadata = resultSet['resultSetMetaData'] as Record<string, unknown> | undefined;
  const rowType = metadata?.['rowType'] as Array<{ name: string }> | undefined;

  let headers: string[];
  if (Array.isArray(rowType) && rowType.length > 0) {
    headers = rowType.map((col) => col.name);
  } else {
    // No metadata — generate generic column names
    headers = (data[0] ?? []).map((_, i) => `COL${i + 1}`);
  }

  const rows: (string | number)[][] = data.map((rawRow) =>
    (rawRow ?? []).map((cell) => {
      if (cell === null) return '';
      const stripped = String(cell).replace(/,/g, '');
      if (stripped !== '' && !isNaN(Number(stripped))) return Number(stripped);
      return String(cell);
    }),
  );

  return { results: { headers, rows } };
}

// ---------------------------------------------------------------------------
// Markdown table extractor
// ---------------------------------------------------------------------------

/**
 * Parse the first markdown table found in text into { results: { headers, rows } }.
 * Handles comma-formatted numbers like "810,198" and trims cell whitespace.
 * Returns undefined if no valid table is found.
 */
function extractMarkdownTable(text: string): { results: { headers: string[]; rows: (string | number)[][] } } | undefined {
  // Find a block of lines that looks like a markdown table
  // Pattern: at least one header row + one separator row + one data row
  const tableMatch = text.match(
    /(\|[^\n]+\|\n\|[\s\-:| ]+\|\n(?:\|[^\n]+\|\n?)+)/,
  );
  if (!tableMatch?.[1]) return undefined;

  const tableLines = tableMatch[1].trim().split('\n');
  if (tableLines.length < 3) return undefined;

  const parseRow = (line: string): string[] =>
    line
      .replace(/^\||\|$/g, '') // strip leading/trailing pipes
      .split('|')
      .map((cell) => cell.trim());

  // First line = headers, second = separator (skip), rest = data rows
  const headers = parseRow(tableLines[0]);
  const dataLines = tableLines.slice(2);

  if (headers.length === 0 || dataLines.length === 0) return undefined;

  const rows: (string | number)[][] = dataLines.map((line) => {
    const cells = parseRow(line);
    return cells.map((cell) => {
      // Normalise: remove commas from numbers ("810,198" → 810198)
      const stripped = cell.replace(/,/g, '');
      if (stripped !== '' && !isNaN(Number(stripped))) return Number(stripped);
      return cell;
    });
  });

  return { results: { headers, rows } };
}
