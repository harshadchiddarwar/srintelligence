/**
 * Intent classifier — combines deterministic pattern matching with an LLM fallback.
 *
 * Classification pipeline:
 *   1. Run matchPatterns() against the message.
 *   2. Zero matches → LLM fallback via anthropic.classifyIntent.
 *   3. Exactly one unique intent → return deterministic.
 *   4. Multiple unique non-ANALYST intents → PIPELINE.
 *   5. Follow-up detection: if prior context includes ANALYST and the message
 *      matches "forecast (that|this|those|them)", extract the forecast intent.
 */

import type { AgentIntent } from '../../types/agent';
import { classifyIntent as llmClassifyIntent } from '../llm/anthropic';
import { matchPatterns } from './patterns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  intent: AgentIntent;
  confidence: 'deterministic' | 'llm' | 'default';
  matchedPatterns: string[];
}

// ---------------------------------------------------------------------------
// Follow-up detection
// ---------------------------------------------------------------------------

const FOLLOW_UP_FORECAST_RE = /\bforecast\s+(that|this|those|them)\b/i;

/**
 * Intents that represent a concrete forecasting operation (not ANALYST or meta-intents).
 */
const FORECAST_INTENTS = new Set<AgentIntent>([
  'FORECAST_PROPHET',
  'FORECAST_SARIMA',
  'FORECAST_HW',
  'FORECAST_XGB',
  'FORECAST_HYBRID',
  'FORECAST_COMPARE',
  'FORECAST_AUTO',
]);

const CLUSTER_INTENTS = new Set<AgentIntent>([
  'CLUSTER',
  'CLUSTER_KMEANS',
  'CLUSTER_DBSCAN',
  'CLUSTER_GM',
  'CLUSTER_HIERARCHICAL',
  'CLUSTER_KMEDOIDS',
  'CLUSTER_COMPARE',
]);

/**
 * Matches explicit new clustering requests (verb-context).
 * Used to distinguish a genuine re-cluster request from a follow-up question
 * that merely contains the words "segment", "cluster", "group" as nouns.
 */
const NEW_CLUSTER_REQUEST_RE =
  /\b(?:re-?cluster(?:ing)?|cluster(?:ing)?|segment(?:ation)?)\s+(?:the\s+data|this\s+data|these\s+records|these\b|this\b|them\b|all\b|by\b|into\b|analysis\b|patients\b|customers\b|records\b|data\b|members\b|claims\b|users\b|physicians\b|drugs\b|population\b)\b|\b(?:run|perform|do|create|find|identify|apply)\s+(?:a\s+)?(?:cluster(?:ing)?|segmentation|grouping)\b|\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:cluster|segment|group|partition|cohort)s?\b/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function classifyIntent(params: {
  message: string;
  conversationContext?: string;
  priorIntents?: AgentIntent[];
}): Promise<ClassificationResult> {
  const { message, conversationContext, priorIntents = [] } = params;

  // ------------------------------------------------------------------
  // Step 5 (checked first — highest specificity):
  // Follow-up "forecast that/this/those/them" after an ANALYST turn.
  // ------------------------------------------------------------------
  if (
    priorIntents.includes('ANALYST') &&
    FOLLOW_UP_FORECAST_RE.test(message)
  ) {
    // Look for a more specific forecast intent in the prior intent list
    const priorForecast = priorIntents.findLast((i) => FORECAST_INTENTS.has(i));
    const resolvedIntent: AgentIntent = priorForecast ?? 'FORECAST_AUTO';
    return {
      intent: resolvedIntent,
      confidence: 'deterministic',
      matchedPatterns: ['follow-up: forecast (that|this|those|them)'],
    };
  }

  // ------------------------------------------------------------------
  // Follow-up cluster suppression:
  // After a CLUSTER turn, messages that mention "segment/cluster/group"
  // as nouns (not as an action verb) should go to ANALYST for Q&A,
  // not trigger a new clustering run.
  // Exception: explicit FORECAST, CAUSAL, or MTREE requests must fall
  // through to normal pattern matching — do NOT suppress them to ANALYST.
  // ------------------------------------------------------------------
  const FORECAST_KEYWORD_RE = /\bforecast(?:ing)?\b|\bpredict(?:ion)?\b|\bproject(?:ion)?\b/i;
  const CAUSAL_KEYWORD_RE   = /\bcausal\b|\bdriver[s]?\b|\battribut(?:e|ion)\b|\bcontribut(?:e|ion)\b/i;
  const MTREE_KEYWORD_RE    = /\bmtree\b|\bmeta.?tree\b|\bdecision.?tree\b/i;
  // Any explicit @Agent tag is a deliberate invocation — never suppress it.
  // This covers @Causal, @CI, @Forecast, @Forecast/Prophet, @MTree, etc.
  const EXPLICIT_AGENT_TAG_RE = /@(?:Causal|CI|Forecast|MTree|Decision|Clustering)\b/i;
  const isOtherMLRequest =
    FORECAST_KEYWORD_RE.test(message) ||
    CAUSAL_KEYWORD_RE.test(message)   ||
    MTREE_KEYWORD_RE.test(message)    ||
    EXPLICIT_AGENT_TAG_RE.test(message);

  if (priorIntents.some((i) => CLUSTER_INTENTS.has(i)) && !isOtherMLRequest) {
    if (!NEW_CLUSTER_REQUEST_RE.test(message)) {
      return {
        intent: 'ANALYST',
        confidence: 'deterministic',
        matchedPatterns: ['follow-up: post-cluster question → ANALYST'],
      };
    }
  }

  // ------------------------------------------------------------------
  // Step 1: Deterministic pattern matching
  // ------------------------------------------------------------------
  const matches = matchPatterns(message);

  // ------------------------------------------------------------------
  // Step 2: Zero matches → LLM fallback
  // ------------------------------------------------------------------
  if (matches.length === 0) {
    try {
      const llmIntent = await llmClassifyIntent(message, conversationContext);
      return {
        intent: llmIntent,
        confidence: 'llm',
        matchedPatterns: [],
      };
    } catch {
      // If LLM fails, fall back to UNKNOWN rather than throwing
      return {
        intent: 'UNKNOWN',
        confidence: 'default',
        matchedPatterns: [],
      };
    }
  }

  const uniqueIntents = [...new Set(matches.map((m) => m.intent))];
  const matchedDescriptions = matches.map((m) => m.pattern.description);

  // ------------------------------------------------------------------
  // Step 3: Exactly one unique intent → deterministic
  // ------------------------------------------------------------------
  if (uniqueIntents.length === 1) {
    return {
      intent: uniqueIntents[0],
      confidence: 'deterministic',
      matchedPatterns: matchedDescriptions,
    };
  }

  // ------------------------------------------------------------------
  // Step 4: Multiple non-ANALYST unique intents
  // ------------------------------------------------------------------
  const nonAnalystIntents = uniqueIntents.filter((i) => i !== 'ANALYST');
  if (nonAnalystIntents.length >= 2) {
    // If every intent shares the same family prefix (e.g. CLUSTER_KMEANS +
    // CLUSTER both belong to "CLUSTER"), a generic catch-all pattern fired
    // alongside a specific algorithm intent.  Collapse to the highest-priority
    // specific intent rather than escalating to PIPELINE.
    const family = (intent: string) => {
      const parts = intent.split('_');
      return parts.length > 1 ? parts[0] : intent;
    };
    const families = new Set(nonAnalystIntents.map(family));
    if (families.size === 1) {
      // All same family — return highest-priority match (matches already sorted)
      return {
        intent: matches[0].intent,
        confidence: 'deterministic',
        matchedPatterns: matchedDescriptions,
      };
    }
    return {
      intent: 'PIPELINE',
      confidence: 'deterministic',
      matchedPatterns: matchedDescriptions,
    };
  }

  // Fallback: return the highest-priority match
  return {
    intent: matches[0].intent,
    confidence: 'deterministic',
    matchedPatterns: matchedDescriptions,
  };
}
