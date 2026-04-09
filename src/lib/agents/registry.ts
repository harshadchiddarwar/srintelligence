/**
 * AgentRegistry — Blueprint v3.0
 *
 * v3.0 simplification: the registry no longer stores agent instances or manages
 * lazy imports of SQL-building agents.  Routing is handled by AGENT_ROUTING_MAP
 * in agent-mapping.ts.  This file now exposes:
 *
 *   • AGENT_CATALOG — a static list of agent descriptions used by the UI
 *     (e.g., the agent picker, help tooltips, cost previews).
 *
 *   • agentRegistry — a lightweight wrapper around AGENT_CATALOG that provides
 *     the same getAgentDescriptions() / hasAgent() interface callers expect,
 *     so existing UI code needs no changes.
 *
 * The AnalystAgent is still available via getAnalystAgent() because it remains
 * the single SQL-generating agent used in PATH A of the dispatcher.
 */

import type { AgentIntent } from '../../types/agent';
import { analystAgent, type AnalystAgent } from './analyst-agent';
import { AGENT_ROUTING_MAP } from './agent-mapping';

// ---------------------------------------------------------------------------
// Public types (kept for UI compatibility)
// ---------------------------------------------------------------------------

export interface AgentDescription {
  name: string;
  displayName: string;
  description: string;
  intent: AgentIntent;
}

/**
 * @deprecated Blueprint v3.0 — Agent instances are no longer registered.
 * Kept as a type alias so existing imports compile without modification.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgent = Record<string, any>;

// ---------------------------------------------------------------------------
// Static catalog (describes the four named Snowflake agents + the analyst)
// ---------------------------------------------------------------------------

export const AGENT_CATALOG: AgentDescription[] = [
  {
    name: 'analyst',
    displayName: 'Cortex Analyst',
    description: 'Translates natural-language questions into SQL and runs them against your data.',
    intent: 'ANALYST',
  },
  {
    name: 'SRI_FORECAST_AGENT',
    displayName: 'Forecast Agent',
    description:
      'Time-series forecasting using Prophet, SARIMA, Holt-Winters, XGBoost, or a hybrid ensemble.',
    intent: 'FORECAST_AUTO',
  },
  {
    name: 'SRI_META_TREE',
    displayName: 'Metric Tree',
    description: 'Decomposes a KPI into a hierarchy of contributing sub-metrics.',
    intent: 'MTREE',
  },
  {
    name: 'SRI_CLUSTERING_AGENT',
    displayName: 'Clustering Agent',
    description:
      'Segments records using Gaussian Mixture, DBSCAN, Hierarchical, K-Means, or K-Medoids algorithms.',
    intent: 'CLUSTER',
  },
  {
    name: 'SRI_CAUSAL_INFERENCE_AGENT',
    displayName: 'Causal Inference Agent',
    description:
      'Identifies causal drivers, validates assumptions, quantifies contributions, and generates narratives.',
    intent: 'CAUSAL_AUTO',
  },
];

// ---------------------------------------------------------------------------
// AgentRegistry (lightweight facade — no agent instances stored)
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private static instance: AgentRegistry;

  private constructor() {}

  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  // -------------------------------------------------------------------------
  // Public API (interface-compatible with v2.x callers)
  // -------------------------------------------------------------------------

  /**
   * Returns null for all intents — agents are no longer stored as instances.
   * Routing is handled by AGENT_ROUTING_MAP; callers should migrate to that.
   *
   * @deprecated Use AGENT_ROUTING_MAP from agent-mapping.ts instead.
   */
  getAgent(_intent: AgentIntent): null {
    return null;
  }

  /**
   * Returns the AnalystAgent instance.
   * PATH A of the dispatcher still uses it for text-to-SQL queries.
   */
  getAnalystAgent(): AnalystAgent {
    return analystAgent;
  }

  /**
   * Return descriptions of all registered agents for UI use.
   * Sourced from AGENT_CATALOG rather than a live agent map.
   */
  getAgentDescriptions(): AgentDescription[] {
    return AGENT_CATALOG;
  }

  /**
   * Check whether a given intent has a registered route.
   * Delegates to AGENT_ROUTING_MAP rather than the old agent Map.
   */
  hasAgent(intent: AgentIntent): boolean {
    return intent in AGENT_ROUTING_MAP;
  }

  /**
   * Return all known AgentIntent values.
   */
  registeredIntents(): AgentIntent[] {
    return Object.keys(AGENT_ROUTING_MAP) as AgentIntent[];
  }
}

// ---------------------------------------------------------------------------
// Pre-constructed singleton export
// ---------------------------------------------------------------------------

export const agentRegistry = AgentRegistry.getInstance();
