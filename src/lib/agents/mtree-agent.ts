/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * MTreeAgent — market-share driver analysis via the SRI_META_TREE Snowflake Cortex Agent.
 *
 * SRI_META_TREE lives in CORTEX_TESTING.ML and is invoked via the Snowflake
 * Cortex Agents REST API:
 *   POST /api/v2/cortex/agent:run
 *
 * The agent accepts a natural-language message describing the data to analyze.
 * input.extraContext.sourceSQL contains the prepared CTE SQL from AnalystAgent.
 * The response is parsed into a waterfall / driver decomposition artifact.
 */

import { randomUUID } from 'crypto';
import { getAuthManager } from '../snowflake/auth';
import type {
  AgentInput,
  AgentResult,
  AgentArtifact,
  AgentIntent,
} from '../../types/agent';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_NAME = 'mtree';
const AGENT_MODEL = 'CORTEX_TESTING.ML.SRI_META_TREE';
const AGENT_INTENT: AgentIntent = 'MTREE';
const BASE_URL = `https://${process.env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com`;

// ---------------------------------------------------------------------------
// Cortex Agent API shapes
// ---------------------------------------------------------------------------

interface CortexAgentContentBlock {
  type: 'text';
  text: string;
}

interface CortexAgentMessage {
  role: 'user' | 'assistant';
  content: CortexAgentContentBlock[];
}

interface CortexAgentRequest {
  model: string;
  messages: CortexAgentMessage[];
}

interface CortexAgentResponseContent {
  type: string;
  text?: string;
  json?: unknown;
}

interface CortexAgentResponse {
  message?: {
    role: string;
    content: CortexAgentResponseContent[];
  };
  error?: {
    message?: string;
    code?: string;
  };
}

// ---------------------------------------------------------------------------
// MTreeAgent
// ---------------------------------------------------------------------------

export class MTreeAgent {
  readonly name = AGENT_NAME;
  readonly displayName = 'Driver Analysis (mTree)';
  readonly description =
    'Identifies key drivers of share change using the SRI mTree methodology via Snowflake Cortex Agents.';
  readonly intent: AgentIntent = AGENT_INTENT;

  // -------------------------------------------------------------------------
  // execute — overrides the base pattern; does not use UDTF SQL
  // -------------------------------------------------------------------------

  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    const lineageId = randomUUID();

    // ------------------------------------------------------------------
    // Input validation
    // ------------------------------------------------------------------
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return this.makeErrorResult(
        'sourceSQL must be a non-empty SQL string.',
        'VALIDATION_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // Cache lookup
    // ------------------------------------------------------------------
    const cacheKey = `mtree:${input.userId}:${hashString(sourceSQL + (input.extraContext?.period as string ?? ''))}`;
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
    // Build natural language message for the Cortex Agent
    // ------------------------------------------------------------------
    const period = (input.extraContext?.period as string | undefined) ?? 'recent vs prior';
    const agentMessage =
      `Analyze the following data to identify the key drivers of change:\n\n` +
      `Data Query:\n${sourceSQL}\n\n` +
      `Period analyzed: ${period}`;

    // ------------------------------------------------------------------
    // Call Snowflake Cortex Agents REST API
    // ------------------------------------------------------------------
    let agentResponseText: string;
    try {
      agentResponseText = await this.callCortexAgent(agentMessage);
    } catch (err) {
      return this.makeErrorResult(
        `Cortex Agent call failed: ${err instanceof Error ? err.message : String(err)}`,
        'AGENT_API_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // Parse agent response into a structured waterfall artifact
    // ------------------------------------------------------------------
    const waterfallData = parseWaterfallResponse(agentResponseText);

    const narrative =
      waterfallData.summary ||
      `mTree driver analysis complete. ${waterfallData.drivers.length} drivers identified.`;

    const artifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: {
        type: 'waterfall',
        drivers: waterfallData.drivers,
        summary: waterfallData.summary,
        rawResponse: agentResponseText,
        sourceSQL,
      },
      narrative,
      createdAt: Date.now(),
      lineageId,
      cacheStatus: 'miss',
    };

    const result: AgentResult = {
      success: true,
      artifact,
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
  // Private: Cortex Agent API call
  // -------------------------------------------------------------------------

  private async callCortexAgent(message: string): Promise<string> {
    const headers = await getAuthManager().getAuthHeaders();

    const requestBody: CortexAgentRequest = {
      model: AGENT_MODEL,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: message }],
        },
      ],
    };

    const response = await fetch(`${BASE_URL}/api/v2/cortex/agent:run`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let errMsg = `Cortex Agent API error: HTTP ${response.status}`;
      try {
        const errJson = (await response.json()) as CortexAgentResponse;
        if (errJson.error?.message) {
          errMsg = errJson.error.message;
        }
      } catch {
        // ignore JSON parse failure
      }
      throw new Error(errMsg);
    }

    const json = (await response.json()) as CortexAgentResponse;

    if (json.error?.message) {
      throw new Error(json.error.message);
    }

    // Concatenate all text blocks from the response
    const contentBlocks = json.message?.content ?? [];
    let text = '';
    for (const block of contentBlocks) {
      if (block.type === 'text' && block.text) {
        text += (text ? '\n' : '') + block.text;
      }
    }

    return text;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

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
// Response parser
// ---------------------------------------------------------------------------

interface WaterfallDriver {
  label: string;
  value: number;
  direction: 'positive' | 'negative' | 'neutral';
}

interface WaterfallData {
  drivers: WaterfallDriver[];
  summary: string;
}

/**
 * Best-effort parse of the mTree agent's natural-language response into
 * structured waterfall driver data. Looks for patterns like:
 *   - "Category X: +2.3pp" or "Category X contributed -1.5 points"
 *
 * Falls back to an empty driver list and uses the raw text as the summary.
 */
function parseWaterfallResponse(text: string): WaterfallData {
  const drivers: WaterfallDriver[] = [];

  // Pattern: "Label: +/-value" where value ends with pp, pt, %, or is bare numeric
  const driverPattern =
    /([A-Za-z][A-Za-z0-9 &\-/()]+?)\s*[:\-–]\s*([+\-]?\d+(?:\.\d+)?)\s*(?:pp|pt|%)?/gi;

  let match: RegExpExecArray | null;
  while ((match = driverPattern.exec(text)) !== null) {
    const label = match[1].trim();
    const value = parseFloat(match[2]);
    if (isNaN(value)) continue;
    drivers.push({
      label,
      value,
      direction: value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral',
    });
  }

  // Extract summary from the first sentence if the text is multi-sentence
  const firstSentence = text.split(/[.!?]\s+/)[0]?.trim() ?? text.trim();
  const summary = firstSentence.length < text.length ? firstSentence + '.' : text.trim();

  return { drivers, summary };
}

// ---------------------------------------------------------------------------
// Utility
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

export const mtreeAgent = new MTreeAgent();
