/**
 * agent-registry.ts — re-export shim for backwards compatibility.
 *
 * Existing API routes import from 'agent-registry'; the canonical module is
 * 'registry'. This file re-exports everything from registry.ts so both
 * import paths resolve to the same singletons.
 */

export {
  AgentRegistry,
  agentRegistry,
  type AnyAgent,
  type AgentDescription,
} from './registry';
