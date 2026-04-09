/**
 * Snowflake Cortex Analyst REST API client.
 *
 * Uses the `semantic_view` parameter (NOT semantic_model_file).
 * Endpoint: POST /api/v2/cortex/analyst/message
 */

import { authManager } from './auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = `https://${process.env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com`;

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
// Cortex Analyst API request/response shapes
// ---------------------------------------------------------------------------

interface AnalystContentBlock {
  type: string;
  text?: string;
  statement?: string;
  suggestions?: string[];
}

interface AnalystMessage {
  role: 'user' | 'analyst';
  content: AnalystContentBlock[];
}

interface AnalystApiResponse {
  request_id?: string;
  message?: {
    role: string;
    content: AnalystContentBlock[];
  };
  error?: {
    message?: string;
    code?: string;
  };
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Call the Snowflake Cortex Analyst API.
 *
 * @param params.question            - The natural language question.
 * @param params.semanticView        - Fully-qualified semantic view name.
 * @param params.conversationHistory - Optional prior conversation turns.
 */
export async function callCortexAnalyst(params: {
  question: string;
  semanticView: string;
  conversationHistory?: AnalystMessage[];
}): Promise<AnalystResponse> {
  const { question, semanticView, conversationHistory = [] } = params;

  const headers = await authManager.getAuthHeaders();

  const userTurn: AnalystMessage = {
    role: 'user',
    content: [{ type: 'text', text: question }],
  };

  const requestBody = {
    messages: [...conversationHistory, userTurn],
    semantic_view: semanticView,
  };

  const response = await fetch(`${BASE_URL}/api/v2/cortex/analyst/message`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errorMessage = `Cortex Analyst request failed: HTTP ${response.status}`;
    try {
      const errJson = (await response.json()) as AnalystApiResponse;
      if (errJson.error?.message) {
        errorMessage = errJson.error.message;
      }
    } catch {
      // ignore JSON parse error; use the status-based message
    }
    return {
      text: '',
      suggestions: [],
      error: errorMessage,
      requestId: undefined,
    };
  }

  const json = (await response.json()) as AnalystApiResponse;

  const requestId = json.request_id;
  const contentBlocks = json.message?.content ?? [];

  let text = '';
  let sql: string | undefined;
  const suggestions: string[] = [];

  for (const block of contentBlocks) {
    switch (block.type) {
      case 'text':
        if (block.text) {
          text += (text ? '\n' : '') + block.text;
        }
        break;
      case 'sql':
        if (block.statement) {
          sql = block.statement;
        }
        break;
      case 'suggestions':
        if (Array.isArray(block.suggestions)) {
          suggestions.push(...block.suggestions);
        }
        break;
      default:
        // Unknown block type — ignore gracefully
        break;
    }
  }

  return { text, sql, suggestions, requestId };
}
