/**
 * ClusteringAgent — data segmentation via the SRI_CLUSTERING_AGENT Snowflake Cortex Agent.
 *
 * SRI_CLUSTERING_AGENT lives in CORTEX_TESTING.ML and is called via the
 * Snowflake Cortex Agents REST API:
 *   POST /api/v2/cortex/agent:run
 *
 * The agent accepts a natural-language message describing how many segments to
 * find and what data to operate on. input.extraContext.sourceSQL contains the
 * prepared CTE SQL from AnalystAgent. The response is parsed into a cluster
 * assignment artifact with segment profiles.
 */

import { randomUUID } from 'crypto';
import { authManager } from '../snowflake/auth';
import type {
  AgentInput,
  AgentResult,
  AgentArtifact,
  AgentIntent,
} from '../../types/agent';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_NAME = 'clustering';
const AGENT_MODEL = 'CORTEX_TESTING.ML.SRI_CLUSTERING_AGENT';
const AGENT_INTENT: AgentIntent = 'CLUSTER';
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
// ClusteringAgent
// ---------------------------------------------------------------------------

export class ClusteringAgent {
  readonly name = AGENT_NAME;
  readonly displayName = 'Segmentation Engine';
  readonly description =
    'Segments customers, products, or any entity into meaningful clusters using SRI_CLUSTERING_AGENT via Snowflake Cortex Agents.';
  readonly intent: AgentIntent = AGENT_INTENT;

  // -------------------------------------------------------------------------
  // execute
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

    const nSegments = input.extraContext?.nSegments as number | string | undefined;
    if (
      nSegments !== undefined &&
      typeof nSegments === 'number' &&
      (nSegments < 2 || nSegments > 50)
    ) {
      return this.makeErrorResult(
        'nSegments must be between 2 and 50.',
        'VALIDATION_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // Cache lookup
    // ------------------------------------------------------------------
    const cacheKey = `clustering:${input.userId}:${hashString(
      sourceSQL + String(nSegments ?? ''),
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
    // Build natural language message for the Cortex Agent
    // ------------------------------------------------------------------
    const segmentDesc = nSegments
      ? `${nSegments}`
      : 'the optimal number of';

    const agentMessage =
      `Segment the following data into ${segmentDesc} clusters:\n\n` +
      `Data:\n${sourceSQL}`;

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
    // Parse response into cluster segments
    // ------------------------------------------------------------------
    const clusterData = parseClusterResponse(agentResponseText, nSegments);

    const narrative =
      clusterData.summary ||
      `Segmentation complete. ${clusterData.segments.length} segments identified.`;

    const artifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: {
        type: 'cluster',
        segments: clusterData.segments,
        summary: clusterData.summary,
        rawResponse: agentResponseText,
        sourceSQL,
        requestedSegments: nSegments,
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
    const headers = await authManager.getAuthHeaders();

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

interface ClusterSegment {
  id: number;
  label: string;
  size?: number;
  characteristics: string[];
}

interface ClusterData {
  segments: ClusterSegment[];
  summary: string;
}

/**
 * Best-effort parse of the clustering agent's natural-language response into
 * structured segment data. Looks for numbered segment / cluster headings.
 */
function parseClusterResponse(
  text: string,
  _requestedSegments: number | string | undefined,
): ClusterData {
  const segments: ClusterSegment[] = [];

  // Pattern: "Cluster N:" or "Segment N:" or "Group N:"
  const clusterHeaderPattern =
    /(?:cluster|segment|group)\s+(\d+)\s*[:\-–]\s*([^\n]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = clusterHeaderPattern.exec(text)) !== null) {
    const id = parseInt(match[1], 10);
    const label = match[2].trim();

    // Try to extract size hint from the surrounding context
    const sizeMatch = /(\d[\d,]+)\s+(?:members?|records?|rows?|items?|customers?)/i.exec(
      text.slice(match.index, match.index + 300),
    );
    const size = sizeMatch ? parseInt(sizeMatch[1].replace(/,/g, ''), 10) : undefined;

    // Extract bullet-point characteristics following the header
    const afterHeader = text.slice(match.index + match[0].length);
    const charPattern = /[-•*]\s+(.+)/g;
    const characteristics: string[] = [];
    let charMatch: RegExpExecArray | null;
    let charSearch = afterHeader.slice(0, 500); // Only look in the next 500 chars
    while ((charMatch = charPattern.exec(charSearch)) !== null && characteristics.length < 5) {
      characteristics.push(charMatch[1].trim());
    }

    if (!isNaN(id)) {
      segments.push({ id, label, size, characteristics });
    }
  }

  // Deduplicate by id
  const seen = new Set<number>();
  const uniqueSegments = segments.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  const firstSentence = text.split(/[.!?]\s+/)[0]?.trim() ?? text.trim();
  const summary = firstSentence.length < text.length ? firstSentence + '.' : text.trim();

  return { segments: uniqueSegments, summary };
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

export const clusteringAgent = new ClusteringAgent();
