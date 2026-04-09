/**
 * User-related types for SRIntelligence.
 * NOTE: AgentIntent is imported here; UserPreferences is consumed by agent.ts
 * to avoid a circular import (agent.ts imports UserPreferences, user.ts imports AgentIntent).
 */

import type { AgentIntent } from './agent';

// ---------------------------------------------------------------------------
// User preferences
// ---------------------------------------------------------------------------

export type ThemePreference = 'light' | 'dark' | 'system';
export type ChartLibrary = 'recharts' | 'nivo' | 'vega';
export type NarrativeLength = 'brief' | 'standard' | 'detailed';

export interface UserPreferences {
  userId: string;
  theme: ThemePreference;
  defaultSemanticViewId?: string;
  preferredChartLibrary: ChartLibrary;
  narrativeLength: NarrativeLength;
  /** Favourite / pinned agent intents shown in the UI */
  pinnedIntents: AgentIntent[];
  /** Custom instruction text prepended to narrative synthesis */
  customNarrativeInstructions?: string;
  /** Whether to show cost estimates in the UI */
  showCostEstimates: boolean;
  /** Whether to show SQL in the UI by default */
  showSqlByDefault: boolean;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitStatus {
  userId: string;
  /** Requests consumed in the current window */
  requestsUsed: number;
  /** Total requests allowed in the window */
  requestsLimit: number;
  /** Tokens consumed in the current window */
  tokensUsed: number;
  tokensLimit: number;
  /** Unix timestamp (ms) when the current window resets */
  windowResetsAt: number;
  /** Whether the user is currently rate-limited */
  isLimited: boolean;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export type FeedbackRating = 1 | 2 | 3 | 4 | 5;
export type FeedbackCategory =
  | 'accuracy'
  | 'relevance'
  | 'speed'
  | 'narrative'
  | 'visualization'
  | 'other';

export interface FeedbackRecord {
  id: string;
  userId: string;
  sessionId: string;
  /** ID of the FormattedResponse or AgentArtifact being rated */
  targetId: string;
  rating: FeedbackRating;
  category: FeedbackCategory;
  comment?: string;
  intent?: AgentIntent;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

export type LineageNodeType = 'user_message' | 'routing' | 'agent' | 'synthesis' | 'response';

export interface LineageNode {
  nodeId: string;
  type: LineageNodeType;
  label: string;
  /** Unix timestamp (ms) */
  startedAt: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface LineageRecord {
  lineageId: string;
  sessionId: string;
  userId: string;
  intent: AgentIntent;
  nodes: LineageNode[];
  /** Edges as [fromNodeId, toNodeId] pairs */
  edges: [string, string][];
  createdAt: number;
}
