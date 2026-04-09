/**
 * AgentRegistry — singleton map from AgentIntent to agent instance.
 *
 * All agent imports are eager (no lazy loading) so that the registry is
 * fully populated on first access. Callers retrieve agents by intent via
 * getAgent(), or access the AnalystAgent directly via getAnalystAgent().
 *
 * FORECAST_AUTO and FORECAST_PROPHET both resolve to prophetAgent as the
 * default automatic-selection strategy (can be updated as confidence in
 * model selection heuristics grows).
 */

import type { AgentIntent } from '../../types/agent';
import { analystAgent, type AnalystAgent } from './analyst-agent';
import { prophetAgent, type ProphetAgent } from './prophet-agent';
import { sarimaAgent, type SarimaAgent } from './sarima-agent';
import { hwAgent, type HWAgent } from './hw-agent';
import { xgboostAgent, type XGBoostAgent } from './xgboost-agent';
import { mtreeAgent, type MTreeAgent } from './mtree-agent';
import { clusteringAgent, type ClusteringAgent } from './clustering-agent';
import { forecastCompareAgent, type ForecastCompareAgent } from './forecast-compare-agent';
import type { BaseAgent } from './base-agent';

// ---------------------------------------------------------------------------
// Union of all agent concrete types
// ---------------------------------------------------------------------------

export type AnyAgent =
  | AnalystAgent
  | ProphetAgent
  | SarimaAgent
  | HWAgent
  | XGBoostAgent
  | MTreeAgent
  | ClusteringAgent
  | ForecastCompareAgent
  | BaseAgent;

// ---------------------------------------------------------------------------
// Agent description shape
// ---------------------------------------------------------------------------

export interface AgentDescription {
  name: string;
  displayName: string;
  description: string;
  intent: AgentIntent;
}

// ---------------------------------------------------------------------------
// AgentRegistry
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private static instance: AgentRegistry;

  private readonly agents: Map<AgentIntent, AnyAgent>;

  private constructor() {
    this.agents = new Map<AgentIntent, AnyAgent>([
      ['ANALYST', analystAgent],
      ['FORECAST_PROPHET', prophetAgent],
      // FORECAST_AUTO resolves to Prophet as the default auto-selection model
      ['FORECAST_AUTO', prophetAgent],
      ['FORECAST_SARIMA', sarimaAgent],
      ['FORECAST_HW', hwAgent],
      ['FORECAST_XGB', xgboostAgent],
      ['FORECAST_COMPARE', forecastCompareAgent],
      ['MTREE', mtreeAgent],
      ['CLUSTER', clusteringAgent],
    ]);
  }

  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Retrieve an agent by intent. Returns null for unmapped intents (e.g.
   * PIPELINE, UNKNOWN) — callers are responsible for handling the null case.
   */
  getAgent(intent: AgentIntent): AnyAgent | null {
    return this.agents.get(intent) ?? null;
  }

  /**
   * Convenience accessor for the AnalystAgent.
   * Use this when you need AnalystAgent-specific methods such as
   * prepareDataForDownstreamAgent().
   */
  getAnalystAgent(): AnalystAgent {
    return analystAgent;
  }

  /**
   * Return descriptions of all registered agents, de-duplicated by intent so
   * that FORECAST_AUTO and FORECAST_PROPHET don't both advertise prophetAgent.
   */
  getAgentDescriptions(): AgentDescription[] {
    const seen = new Set<AnyAgent>();
    const descriptions: AgentDescription[] = [];

    for (const [intent, agent] of this.agents) {
      if (seen.has(agent)) continue;
      seen.add(agent);

      descriptions.push({
        name: agent.name,
        displayName: agent.displayName,
        description: agent.description,
        intent,
      });
    }

    return descriptions;
  }

  /**
   * Check whether a given intent has a registered agent.
   */
  hasAgent(intent: AgentIntent): boolean {
    return this.agents.has(intent);
  }

  /**
   * Return all registered AgentIntent values (useful for validation).
   */
  registeredIntents(): AgentIntent[] {
    return [...this.agents.keys()];
  }
}

// ---------------------------------------------------------------------------
// Pre-constructed singleton export
// ---------------------------------------------------------------------------

export const agentRegistry = AgentRegistry.getInstance();
