/**
 * Snowflake Cortex Agent client — calls SRI_ANALYST_AGENT via the named
 * agent REST endpoint.
 *
 * Endpoint: POST /api/v2/databases/{db}/schemas/{schema}/agents/{name}:run
 *
 * The named agent has the semantic view and instructions already configured
 * in Snowflake, so we only pass the conversation messages.
 */

import { authManager } from './auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = `https://${process.env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com`;
const AGENT_DB = 'CORTEX_TESTING';
const AGENT_SCHEMA = 'ML';
const AGENT_NAME = 'SRI_ANALYST_AGENT';
const SNOWFLAKE_ROLE = process.env.SNOWFLAKE_ROLE ?? 'APP_SVC_ROLE';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AnalystResponse {
  text: string;
  sql?: string;
  suggestions: string[];
  error?: string;
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Internal message shapes
// ---------------------------------------------------------------------------

// Cortex Analyst messages use role 'analyst'; named-agent endpoint uses 'assistant'
interface AnalystMessage {
  role: 'user' | 'analyst';
  content: Array<{ type: string; text?: string; statement?: string; suggestions?: string[] }>;
}

interface AgentMessage {
  role: 'user' | 'assistant';
  content: Array<{ type: 'text'; text: string }>;
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
  const { question, conversationHistory = [], signal } = params;

  // Build base headers and add the role header required for tool calls
  const baseHeaders = await authManager.getAuthHeaders();
  const headers: Record<string, string> = {
    ...baseHeaders,
    'X-Snowflake-Role': SNOWFLAKE_ROLE,
    // Override Accept to signal we can receive an SSE stream
    Accept: 'application/json, text/event-stream',
  };

  // Convert 'analyst' role → 'assistant' for the named-agent endpoint
  const agentHistory: AgentMessage[] = conversationHistory.map((m) => ({
    role: m.role === 'analyst' ? 'assistant' : 'user',
    content: [
      {
        type: 'text' as const,
        text:
          m.content
            .filter((b) => b.type === 'text' && b.text)
            .map((b) => b.text ?? '')
            .join('\n') || '(no content)',
      },
    ],
  }));

  const userTurn: AgentMessage = {
    role: 'user',
    content: [{ type: 'text', text: question }],
  };

  const messages: AgentMessage[] = [...agentHistory, userTurn];

  const agentUrl = `${BASE_URL}/api/v2/databases/${AGENT_DB}/schemas/${AGENT_SCHEMA}/agents/${AGENT_NAME}:run`;

  let response: Response;
  try {
    response = await fetch(agentUrl, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({ messages, stream: true }),
    });
  } catch (fetchErr) {
    return {
      text: '',
      suggestions: [],
      error: `Network error calling SRI_ANALYST_AGENT: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
    };
  }

  if (!response.ok) {
    let errorMessage = `SRI_ANALYST_AGENT request failed: HTTP ${response.status}`;
    try {
      const rawText = await response.text();
      try {
        const errJson = JSON.parse(rawText) as Record<string, unknown>;
        const msg =
          (errJson['message'] as string | undefined) ??
          ((errJson['error'] as Record<string, string> | undefined)?.['message']) ??
          rawText;
        if (msg) errorMessage = `SRI_ANALYST_AGENT ${response.status}: ${msg}`;
      } catch {
        if (rawText.trim()) errorMessage = `SRI_ANALYST_AGENT ${response.status}: ${rawText.trim()}`;
      }
    } catch {
      // ignore; keep status-based message
    }
    return { text: '', suggestions: [], error: errorMessage };
  }

  // ---------------------------------------------------------------------------
  // Parse the SSE / JSON response
  // ---------------------------------------------------------------------------
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream')) {
    return parseSSEStream(response, signal);
  }

  // Non-streaming JSON fallback
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
  const suggestions: string[] = [];

  // Track current SSE event (multi-line SSE: event: + data:)
  let currentEventType = '';

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
            const chunk = extractTextChunk(json, currentEventType);
            if (chunk) fullText += chunk;

            const sql = extractSqlFromEvent(json, currentEventType);
            if (sql && !extractedSql) extractedSql = sql;

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

  // Attempt to pull SQL from markdown code blocks in the final text
  if (!extractedSql) {
    extractedSql = extractSqlFromText(fullText) ?? undefined;
  }

  // Remove SQL code blocks from the display narrative so they don't appear twice
  const displayText = extractedSql
    ? fullText.replace(/```sql[\s\S]*?```/gi, '').trim()
    : fullText.trim();

  return {
    text: displayText || fullText.trim(),
    sql: extractedSql,
    suggestions,
  };
}

// ---------------------------------------------------------------------------
// Non-streaming JSON response extractor
// ---------------------------------------------------------------------------

function extractFromJsonResponse(json: Record<string, unknown>): AnalystResponse {
  // Try common shapes
  const message = json['message'] as Record<string, unknown> | undefined;
  const content = (message?.['content'] ?? json['content']) as
    | Array<Record<string, unknown>>
    | undefined;

  let text = '';
  let sql: string | undefined;

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        text += block['text'];
      }
      if (block['type'] === 'sql' && typeof block['statement'] === 'string') {
        sql = block['statement'];
      }
    }
  } else if (typeof json['text'] === 'string') {
    text = json['text'];
  }

  if (!sql && text) {
    sql = extractSqlFromText(text) ?? undefined;
  }

  const displayText = sql ? text.replace(/```sql[\s\S]*?```/gi, '').trim() : text.trim();

  return { text: displayText || text, sql, suggestions: [] };
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

  if (embeddedEvent === 'response.tool_result') {
    const data = event['data'] as Record<string, unknown> | undefined;

    // Cortex Analyst tool result carries { sql: "...", text: "..." }
    const result = (data?.['result'] ?? data?.['output']) as
      | Record<string, unknown>
      | string
      | undefined;

    if (typeof result === 'string') {
      return extractSqlFromText(result);
    }

    if (result && typeof result === 'object') {
      if (typeof result['sql'] === 'string') return result['sql'];
      if (typeof result['statement'] === 'string') return result['statement'];
      // Nested: { content: [{ type: 'sql', statement: '...' }] }
      const contentArr = result['content'] as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(contentArr)) {
        for (const b of contentArr) {
          if (b['type'] === 'sql' && typeof b['statement'] === 'string') return b['statement'];
        }
      }
    }
  }

  // Anthropic tool result / tool_use blocks
  if (event['type'] === 'tool_result' || event['type'] === 'tool_use') {
    const input = event['input'] as Record<string, unknown> | undefined;
    if (input && typeof input['sql'] === 'string') return input['sql'];
    if (input && typeof input['query'] === 'string') return input['query'];
  }

  // Anthropic content_block_start with tool_use (the Cortex Analyst tool call)
  if (event['type'] === 'content_block_start') {
    const cb = event['content_block'] as Record<string, unknown> | undefined;
    if (cb?.['type'] === 'tool_use') {
      const input = cb['input'] as Record<string, unknown> | undefined;
      if (typeof input?.['sql'] === 'string') return input['sql'];
      if (typeof input?.['query'] === 'string') return input['query'];
    }
  }

  // Snowflake message_delta carrying tool result content
  if (event['type'] === 'message_delta') {
    const content = event['content'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block['type'] === 'tool_result') {
          const c = block['content'] as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(c)) {
            for (const b of c) {
              if (b['type'] === 'sql' && typeof b['statement'] === 'string') return b['statement'];
              if (b['type'] === 'text' && typeof b['text'] === 'string') {
                const sql = extractSqlFromText(b['text']);
                if (sql) return sql;
              }
            }
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
