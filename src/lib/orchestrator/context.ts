/**
 * ExecutionContext — holds all session-scoped state threaded through the
 * orchestration pipeline.
 */

import type {
  AgentIntent,
  AgentResult,
  AgentContext,
  ConversationMessage,
  SemanticViewRef,
  CostEstimate,
} from '../../types/agent';
import type { UserPreferences } from '../../types/user';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY_LENGTH = 50;

// ---------------------------------------------------------------------------
// Serialisation shape (plain object, no Maps)
// ---------------------------------------------------------------------------

interface ExecutionContextJSON {
  sessionId: string;
  userId: string;
  userRole: string;
  semanticView: SemanticViewRef;
  availableSemanticViews: SemanticViewRef[];
  conversationHistory: ConversationMessage[];
  intermediateResults: Array<[string, AgentResult]>;
  metadata: Record<string, unknown>;
  userPreferences: UserPreferences;
}

// ---------------------------------------------------------------------------
// ExecutionContext
// ---------------------------------------------------------------------------

export class ExecutionContext implements AgentContext {
  sessionId: string;
  userId: string;
  userRole: string;
  semanticView: SemanticViewRef;
  availableSemanticViews: SemanticViewRef[];
  conversationHistory: ConversationMessage[];
  intermediateResults: Map<string, AgentResult>;
  metadata: Record<string, unknown>;
  userPreferences: UserPreferences;

  // AgentContext compat fields
  totalCostEstimate: CostEstimate = {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    model: 'unknown',
  };
  priorResults: Map<string, AgentResult> = new Map();
  startedAt: number = Date.now();
  bypassCache: boolean = false;

  constructor(params: {
    sessionId: string;
    userId: string;
    userRole: string;
    semanticView?: SemanticViewRef;
    availableSemanticViews?: SemanticViewRef[];
    userPreferences?: UserPreferences;
    metadata?: Record<string, unknown>;
  }) {
    this.sessionId = params.sessionId;
    this.userId = params.userId;
    this.userRole = params.userRole;
    this.semanticView = params.semanticView ?? {
      id: '',
      displayName: 'Default',
      description: '',
      fullyQualifiedName: '',
      allowedRoles: [],
      isDefault: true,
      tags: [],
    };
    this.availableSemanticViews = params.availableSemanticViews ?? [];
    this.userPreferences = params.userPreferences ?? {
      userId: params.userId,
      theme: 'system',
      preferredChartLibrary: 'recharts',
      narrativeLength: 'standard',
      pinnedIntents: [],
      showCostEstimates: true,
      showSqlByDefault: false,
      updatedAt: Date.now(),
    };
    this.conversationHistory = [];
    this.intermediateResults = new Map();
    this.metadata = params.metadata ?? {};
  }

  // ---------------------------------------------------------------------------
  // Conversation history management
  // ---------------------------------------------------------------------------

  addMessage(msg: ConversationMessage): void {
    this.conversationHistory.push(msg);
    // Trim oldest messages when over the cap
    if (this.conversationHistory.length > MAX_HISTORY_LENGTH) {
      this.conversationHistory = this.conversationHistory.slice(
        this.conversationHistory.length - MAX_HISTORY_LENGTH,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Intermediate results
  // ---------------------------------------------------------------------------

  storeResult(key: string, result: AgentResult): void {
    this.intermediateResults.set(key, result);
    this.priorResults.set(key, result);
  }

  getResult(key: string): AgentResult | undefined {
    return this.intermediateResults.get(key);
  }

  // ---------------------------------------------------------------------------
  // Convenience helpers for downstream agents
  // ---------------------------------------------------------------------------

  /** Returns the SQL from the last ANALYST assistant message in history. */
  getLastAnalystSQL(): string | undefined {
    for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
      const msg = this.conversationHistory[i];
      if (msg.role === 'assistant' && msg.intent === 'ANALYST' && msg.artifactId) {
        // Try intermediateResults for the artifact
        for (const [, result] of this.intermediateResults) {
          if (result.artifact?.intent === 'ANALYST' && result.artifact.sql) {
            return result.artifact.sql;
          }
        }
      }
    }
    // Fallback: scan intermediateResults directly
    for (const [, result] of this.intermediateResults) {
      if (result.artifact?.intent === 'ANALYST' && result.artifact.sql) {
        return result.artifact.sql;
      }
    }
    return undefined;
  }

  /** Returns the columns from the last ANALYST result in intermediateResults. */
  getLastAnalystColumns(): string[] | undefined {
    for (const [, result] of this.intermediateResults) {
      if (result.artifact?.intent === 'ANALYST') {
        const data = result.artifact.data as Record<string, unknown> | undefined;
        // Analyst data shape: { results: { headers: string[], rows: ... } }
        const headers = (data?.['results'] as { headers?: string[] } | undefined)?.headers;
        if (Array.isArray(headers) && headers.length > 0) return headers;
      }
    }
    return undefined;
  }

  /**
   * Returns the SQL and output column names from the most recent ANALYST result.
   * Used by the clustering dispatcher to scope RECORD_ID + FEATURES to a
   * prior analyst cohort without re-querying Cortex Analyst.
   */
  getLastAnalystResult(): { sql: string; columns: string[] } | undefined {
    for (const [, result] of this.intermediateResults) {
      if (result.artifact?.intent === 'ANALYST' && result.artifact.sql) {
        const data = result.artifact.data as Record<string, unknown> | undefined;
        const headers = (data?.['results'] as { headers?: string[] } | undefined)?.headers ?? [];
        return { sql: result.artifact.sql, columns: headers };
      }
    }
    return undefined;
  }

  /**
   * Stores metadata about the most recent clustering run so that downstream
   * FORECAST / CAUSAL agents can reference cluster assignments.
   */
  storeClusterMeta(meta: {
    nClusters: number;
    recordIdCol: string | undefined;
    algorithm: string;
    runId: string;
  }): void {
    this.intermediateResults.set('CLUSTER_META_latest', {
      success: true,
      durationMs: 0,
      retryCount: 0,
      artifact: {
        id: 'cluster_meta',
        agentName: 'cluster',
        intent: 'CLUSTER' as import('../../types/agent').AgentIntent,
        sql: '',
        data: meta,
        narrative: '',
        createdAt: Date.now(),
        lineageId: '',
        cacheStatus: 'miss',
      },
    });
  }

  /**
   * Returns metadata from the most recent clustering run, if any.
   */
  getLastClusterMeta(): {
    nClusters: number;
    recordIdCol: string | undefined;
    algorithm: string;
    runId: string;
  } | undefined {
    const entry = this.intermediateResults.get('CLUSTER_META_latest');
    if (!entry?.artifact?.data) return undefined;
    return entry.artifact.data as {
      nClusters: number;
      recordIdCol: string | undefined;
      algorithm: string;
      runId: string;
    };
  }

  // ---------------------------------------------------------------------------
  // Semantic view switching
  // ---------------------------------------------------------------------------

  switchSemanticView(view: SemanticViewRef): void {
    const found = this.availableSemanticViews.find((v) => v.id === view.id);
    if (!found) {
      throw new Error(`Semantic view '${view.id}' is not available in this context.`);
    }
    this.semanticView = found;
  }

  // ---------------------------------------------------------------------------
  // Serialisation
  // ---------------------------------------------------------------------------

  toJSON(): string {
    const plain: ExecutionContextJSON = {
      sessionId: this.sessionId,
      userId: this.userId,
      userRole: this.userRole,
      semanticView: this.semanticView,
      availableSemanticViews: this.availableSemanticViews,
      conversationHistory: this.conversationHistory,
      intermediateResults: Array.from(this.intermediateResults.entries()),
      metadata: this.metadata,
      userPreferences: this.userPreferences,
    };
    return JSON.stringify(plain);
  }

  static fromJSON(json: string): ExecutionContext {
    const plain = JSON.parse(json) as ExecutionContextJSON;
    const ctx = new ExecutionContext({
      sessionId: plain.sessionId,
      userId: plain.userId,
      userRole: plain.userRole,
      semanticView: plain.semanticView ?? undefined,
      availableSemanticViews: plain.availableSemanticViews ?? [],
      userPreferences: plain.userPreferences ?? undefined,
      metadata: plain.metadata,
    });
    ctx.conversationHistory = plain.conversationHistory;
    ctx.intermediateResults = new Map(plain.intermediateResults);
    ctx.priorResults = new Map(plain.intermediateResults);
    return ctx;
  }
}
