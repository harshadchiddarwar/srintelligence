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
 */

import { authManager } from './auth';
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
const SNOWFLAKE_ROLE = process.env.SNOWFLAKE_ROLE ?? 'APP_SVC_ROLE';

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
 * @param agentRef   Fully-qualified agent name, e.g. "CORTEX_TESTING.ML.SRI_FORECAST_AGENT"
 * @param messages   Conversation messages (role: 'user' | 'assistant', content: string)
 * @param signal     Optional AbortSignal for cancellation
 */
export async function callCortexAgent(
  agentRef: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal,
): Promise<CortexAgentResponse> {
  const startMs = Date.now();
  const { db, schema, name } = parseAgentRef(agentRef);

  const agentMessages = messages.map((m) => ({
    role: m.role,
    content: [{ type: 'text' as const, text: m.content }],
  }));

  const agentUrl = `${BASE_URL}/api/v2/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(schema)}/agents/${encodeURIComponent(name)}:run`;

  // Clear log file for this request
  try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
  appendLog(`>>> calling agent: ${agentRef}`);
  appendLog(`>>> url: ${agentUrl}`);
  appendLog(`>>> role: ${SNOWFLAKE_ROLE}`);
  appendLog(`>>> messages[0]: ${messages[0]?.content?.slice(0, 300)}`);
  console.log(`[CORTEX_AGENT] >>> calling agent: ${agentRef}`);
  console.log(`[CORTEX_AGENT] >>> url: ${agentUrl}`);
  console.log(`[CORTEX_AGENT] >>> role: ${SNOWFLAKE_ROLE}`);
  console.log(`[CORTEX_AGENT] >>> messages[0] (truncated): ${messages[0]?.content?.slice(0, 200)}`);

  let response: Response;
  try {
    const baseHeaders = await authManager.getAuthHeaders();
    const headers: Record<string, string> = {
      ...baseHeaders,
      'X-Snowflake-Role': SNOWFLAKE_ROLE,
      Accept: 'application/json, text/event-stream',
    };

    console.time(`[CORTEX_AGENT] ${name} fetch`);
    response = await fetch(agentUrl, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({ messages: agentMessages, stream: true }),
    });
    console.timeEnd(`[CORTEX_AGENT] ${name} fetch`);
  } catch (fetchErr) {
    const errMsg = `Network error calling ${name}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`;
    console.error(`[CORTEX_AGENT] NETWORK ERROR: ${errMsg}`);
    return { text: '', executionTimeMs: Date.now() - startMs, error: errMsg };
  }

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

  // ---------------------------------------------------------------------------
  // Parse response (streaming or JSON)
  // ---------------------------------------------------------------------------
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream')) {
    console.log(`[CORTEX_AGENT] parsing SSE stream for ${name}`);
    console.time(`[CORTEX_AGENT] ${name} SSE`);
    const parsed = await parseSSEStream(response, name, signal);
    console.timeEnd(`[CORTEX_AGENT] ${name} SSE`);
    console.log(`[CORTEX_AGENT] SSE result: text=${parsed.text.length} chars, sql=${!!parsed.sql}, data=${!!parsed.data}, error=${parsed.error}`);
    if (parsed.error) console.error(`[CORTEX_AGENT] SSE error: ${parsed.error}`);
    return { ...parsed, executionTimeMs: Date.now() - startMs };
  }

  // Non-streaming JSON fallback
  console.log(`[CORTEX_AGENT] parsing JSON response for ${name}`);
  try {
    const rawBody = await response.text();
    console.log(`[CORTEX_AGENT] JSON body (first 500 chars): ${rawBody.slice(0, 500)}`);
    const json = JSON.parse(rawBody) as Record<string, unknown>;
    const parsed = extractFromJsonResponse(json, name);
    console.log(`[CORTEX_AGENT] JSON result: text=${parsed.text.length} chars, sql=${!!parsed.sql}, data=${!!parsed.data}`);
    return { ...parsed, executionTimeMs: Date.now() - startMs };
  } catch (jsonErr) {
    console.error(`[CORTEX_AGENT] JSON parse error: ${jsonErr}`);
    const raw = await response.text().catch(() => '');
    return { text: raw, executionTimeMs: Date.now() - startMs };
  }
}

// ---------------------------------------------------------------------------
// SSE stream parser (mirrors analyst-api.ts, adapted for generic agents)
// ---------------------------------------------------------------------------

type ParsedPayload = Omit<CortexAgentResponse, 'executionTimeMs'>;

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
          if (data === '[DONE]') { console.log(`[CORTEX_AGENT][SSE] [DONE] received after ${rawEventCount} events`); continue; }

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

            // ── Accumulate input_json_delta tool inputs ───────────────────
            if (json['type'] === 'content_block_delta') {
              const delta = json['delta'] as Record<string, unknown> | undefined;
              if (delta?.['type'] === 'input_json_delta' && typeof delta['partial_json'] === 'string') {
                const idx = (json['index'] as number | undefined) ?? 0;
                toolInputAccum.set(idx, (toolInputAccum.get(idx) ?? '') + delta['partial_json']);
              }
            }

            if (json['type'] === 'content_block_stop') {
              const idx = (json['index'] as number | undefined) ?? 0;
              const accumulated = toolInputAccum.get(idx);
              if (accumulated) {
                toolInputAccum.delete(idx);
                try {
                  const toolInput = JSON.parse(accumulated) as Record<string, unknown>;
                  if (!extractedSql) {
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

            // ── Attempt to detect structured data payloads ────────────────
            // Named agents may surface their result as a tool result containing JSON
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
    if (!fullText) {
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

  const summary = `SSE complete: totalEvents=${rawEventCount} fullText=${fullText.length} chars, sql=${!!extractedSql}, data=${!!extractedData}`;
  console.log(`[CORTEX_AGENT] ${summary}`);
  appendLog(summary);
  if (fullText.length > 0) { console.log(`[CORTEX_AGENT] SSE fullText (first 300): ${fullText.slice(0, 300)}`); appendLog(`fullText: ${fullText.slice(0, 500)}`); }
  if (extractedData) console.log(`[CORTEX_AGENT] SSE extractedData keys: ${JSON.stringify(Object.keys(extractedData as object)).slice(0, 200)}`);

  // Remove SQL/JSON code blocks from display text
  const displayText = fullText
    .replace(/```sql[\s\S]*?```/gi, '')
    .replace(/```json[\s\S]*?```/gi, '')
    .trim();

  return {
    text: displayText || fullText.trim(),
    sql: extractedSql,
    data: extractedData,
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
