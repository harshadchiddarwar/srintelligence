/**
 * chat-to-workflow — converts a chat session's ConversationMessage history
 * into a PipelineDefinition that can be saved as a workflow.
 */

import { randomUUID } from 'crypto';
import type { ConversationMessage, AgentIntent, PipelineDefinition, PipelineStep } from '../../types/agent';

// ---------------------------------------------------------------------------
// chatToPipeline
// ---------------------------------------------------------------------------

/**
 * Walks the conversation history and extracts assistant turns that have an
 * associated intent.  Each such turn becomes a PipelineStep.  Dependencies
 * are wired sequentially (each step depends on the previous), unless the step
 * is an ANALYST that precedes a downstream agent — in which case the
 * downstream agent explicitly depends on the ANALYST step.
 */
export function chatToPipeline(conversationHistory: ConversationMessage[]): PipelineDefinition {
  const agentMessages = conversationHistory.filter(
    (msg) => msg.role === 'assistant' && msg.intent && msg.intent !== 'UNKNOWN',
  );

  const steps: PipelineStep[] = [];

  // Track the most recent ANALYST step to wire as dependency for downstream agents
  let lastAnalystStepId: string | null = null;
  let lastStepId: string | null = null;

  for (const msg of agentMessages) {
    const intent = msg.intent as AgentIntent;
    const stepId = `step_${steps.length + 1}_${intent.toLowerCase()}`;
    const agentName = intentToAgentName(intent);

    const dependsOn: string[] = [];

    if (intent === 'ANALYST') {
      // ANALYST steps have no upstream dependency (they start a chain)
      // but depend on the prior step if there was a prior ANALYST
      if (lastAnalystStepId) {
        // Multiple ANALYST steps are sequential
        dependsOn.push(lastAnalystStepId);
      }
      lastAnalystStepId = stepId;
    } else {
      // Downstream agents: always depend on the last ANALYST step if one exists
      if (lastAnalystStepId) {
        dependsOn.push(lastAnalystStepId);
      } else if (lastStepId) {
        dependsOn.push(lastStepId);
      }
    }

    const step: PipelineStep = {
      stepId,
      intent,
      agentName,
      description: extractDescription(msg),
      dependsOn,
      required: isRequiredStep(intent),
      params: {
        nlQuery: extractNlQuery(conversationHistory, msg),
      },
    };

    steps.push(step);
    lastStepId = stepId;
  }

  // Ensure ANALYST is first if present
  const analystIdx = steps.findIndex((s) => s.intent === 'ANALYST');
  if (analystIdx > 0) {
    const [analystStep] = steps.splice(analystIdx, 1);
    steps.unshift(analystStep);
    // Re-wire: clear dependsOn for the moved step, update subsequent steps
    analystStep.dependsOn = [];
  }

  const pipeline: PipelineDefinition & { finalSynthesis?: boolean; createdFrom?: string } = {
    id: randomUUID(),
    name: 'Chat-derived Workflow',
    description: `Automatically created from chat session with ${steps.length} steps.`,
    steps,
    parallelizable: false,
    createdAt: Date.now(),
    semanticViewDisplayName: 'Chat Session',
    finalSynthesis: true,
    createdFrom: 'chat',
  };

  return pipeline;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function intentToAgentName(intent: AgentIntent): string {
  const map: Partial<Record<AgentIntent, string>> = {
    ANALYST: 'analyst',
    FORECAST_PROPHET: 'prophet',
    FORECAST_SARIMA: 'sarima',
    FORECAST_HW: 'holtwinters',
    FORECAST_XGB: 'xgboost',
    FORECAST_AUTO: 'auto-forecast',
    FORECAST_COMPARE: 'forecast-compare',
    MTREE: 'mtree',
    CLUSTER: 'clustering',
    PIPELINE: 'pipeline',
  };
  return map[intent] ?? 'analyst';
}

function isRequiredStep(intent: AgentIntent): boolean {
  // ANALYST and PIPELINE steps are always required
  return intent === 'ANALYST' || intent === 'PIPELINE';
}

function extractDescription(msg: ConversationMessage): string {
  // Trim to first 120 chars to keep descriptions concise
  return msg.content.slice(0, 120).replace(/\n/g, ' ');
}

/**
 * Looks back in conversation history for the user turn immediately before
 * the given assistant message and returns its content as the NL query.
 */
function extractNlQuery(
  history: ConversationMessage[],
  assistantMsg: ConversationMessage,
): string {
  const idx = history.indexOf(assistantMsg);
  if (idx <= 0) return assistantMsg.content.slice(0, 200);

  for (let i = idx - 1; i >= 0; i--) {
    if (history[i]?.role === 'user') {
      return history[i]!.content.slice(0, 500);
    }
  }

  return assistantMsg.content.slice(0, 200);
}
