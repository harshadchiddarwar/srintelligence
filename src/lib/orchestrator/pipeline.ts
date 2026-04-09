/**
 * PipelineExecutor — Blueprint v3.0
 *
 * Async generator that drives a multi-step agent pipeline, honouring
 * dependency ordering, circuit breaking, and retry logic.
 *
 * v3.0 changes:
 *   • resolveAgent() is replaced by the AGENT_ROUTING_MAP.  Each step is now
 *     executed via callCortexAgent() (PATH B) or analystAgent.execute() (PATH A),
 *     exactly as the single-turn RouteDispatcher does.
 *   • enrichStepWithPriorResults() injects narrative / SQL / data summaries
 *     from completed upstream steps into the downstream step message so named
 *     Cortex Agents have full context.
 *   • summarizePriorResult() (imported from agent-mapping.ts) formats result
 *     summaries for context injection.
 */

import { randomUUID } from 'crypto';
import type {
  AgentIntent,
  AgentResult,
  AgentArtifact,
  AgentInput,
  PipelineDefinition,
  PipelineStep,
} from '../../types/agent';
import { ExecutionContext } from './context';
import { RETRY_CONFIG, classifyError, isRetryable, circuitBreaker } from './error-handling';
import { analystAgent } from '../agents/analyst-agent';
import { AGENT_ROUTING_MAP, enrichMessage, summarizePriorResult } from '../agents/agent-mapping';
import { callCortexAgent } from '../snowflake/cortex-agent-api';

// ---------------------------------------------------------------------------
// Pipeline event shapes (internal — richer than the type in agent.ts)
// ---------------------------------------------------------------------------

export type PipelineEventType =
  | 'step_start'
  | 'step_complete'
  | 'step_error'
  | 'synthesis'
  | 'done';

export interface PipelineStepStartEvent {
  type: 'step_start';
  stepId: string;
  agentName: string;
  timestamp: number;
}

export interface PipelineStepCompleteEvent {
  type: 'step_complete';
  stepId: string;
  result: AgentResult;
  timestamp: number;
}

export interface PipelineStepErrorEvent {
  type: 'step_error';
  stepId: string;
  error: string;
  errorType: string;
  skippedDependents: string[];
  timestamp: number;
}

export interface PipelineSynthesisEvent {
  type: 'synthesis';
  narrative: string;
  timestamp: number;
}

export interface PipelineDoneEvent {
  type: 'done';
  progress: { completed: number; total: number };
  timestamp: number;
}

export type PipelineEvent =
  | PipelineStepStartEvent
  | PipelineStepCompleteEvent
  | PipelineStepErrorEvent
  | PipelineSynthesisEvent
  | PipelineDoneEvent;

// ---------------------------------------------------------------------------
// Narrative synthesis helper
// ---------------------------------------------------------------------------

async function synthesizeNarrative(
  context: ExecutionContext,
  pipeline: PipelineDefinition,
): Promise<string> {
  const lines: string[] = [
    `## Pipeline: ${pipeline.name}`,
    '',
    pipeline.description,
    '',
    '### Step Results',
    '',
  ];

  for (const step of pipeline.steps) {
    const result = context.getResult(step.stepId);
    if (!result) {
      lines.push(`- **${step.agentName}** (${step.stepId}): _not executed_`);
      continue;
    }
    if (!result.success) {
      lines.push(`- **${step.agentName}** (${step.stepId}): failed — ${result.error ?? 'unknown error'}`);
      continue;
    }
    const narrative = result.artifact?.narrative ?? '_No narrative generated._';
    lines.push(`- **${step.agentName}** (${step.stepId}): ${narrative}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// PipelineExecutor
// ---------------------------------------------------------------------------

export class PipelineExecutor {
  constructor(private context: ExecutionContext) {}

  async *execute(
    pipeline: PipelineDefinition,
    parameters: Record<string, unknown>,
  ): AsyncGenerator<PipelineEvent> {
    const total = pipeline.steps.length;
    let completed = 0;
    const skipped = new Set<string>();

    for (const step of pipeline.steps) {
      // --- Check if any dependency failed (skip if so) ---
      const depFailed = step.dependsOn.some((depId) => skipped.has(depId));
      if (depFailed) {
        skipped.add(step.stepId);
        yield {
          type: 'step_error',
          stepId: step.stepId,
          error: `Skipped because dependency failed: ${step.dependsOn.filter((d) => skipped.has(d)).join(', ')}`,
          errorType: 'DEPENDENCY_FAILED',
          skippedDependents: [step.stepId],
          timestamp: Date.now(),
        };
        continue;
      }

      // --- Check dependencies are satisfied ---
      const depsComplete = step.dependsOn.every((depId) =>
        this.context.getResult(depId) !== undefined,
      );
      if (!depsComplete) {
        skipped.add(step.stepId);
        yield {
          type: 'step_error',
          stepId: step.stepId,
          error: `Cannot run: unsatisfied dependencies: ${step.dependsOn.filter((d) => !this.context.getResult(d)).join(', ')}`,
          errorType: 'UNSATISFIED_DEPENDENCY',
          skippedDependents: [step.stepId],
          timestamp: Date.now(),
        };
        continue;
      }

      // --- Circuit breaker check ---
      const breakerKey = `pipeline:${step.agentName}`;
      if (circuitBreaker.isOpen(breakerKey)) {
        skipped.add(step.stepId);
        yield {
          type: 'step_error',
          stepId: step.stepId,
          error: `Circuit breaker open for agent '${step.agentName}' — too many recent failures.`,
          errorType: 'CIRCUIT_OPEN',
          skippedDependents: this.findDependents(pipeline, step.stepId),
          timestamp: Date.now(),
        };
        continue;
      }

      // --- Step start ---
      yield {
        type: 'step_start',
        stepId: step.stepId,
        agentName: step.agentName,
        timestamp: Date.now(),
      };

      // --- Execute with retry ---
      let result: AgentResult | null = null;
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
        if (attempt > 0) {
          const backoff = RETRY_CONFIG.backoffMs[attempt - 1] ?? 3000;
          await new Promise((r) => setTimeout(r, backoff));
        }

        try {
          result = await this.executeStep(step, parameters);
          if (result.success) {
            circuitBreaker.reset(breakerKey);
            break;
          }
          lastError = result.error;
          const errorType = classifyError(new Error(result.error ?? 'unknown'));
          if (!isRetryable(errorType)) break;
        } catch (err) {
          lastError = err;
          const errorType = classifyError(err);
          if (!isRetryable(errorType)) break;
          circuitBreaker.recordFailure(breakerKey);
        }
      }

      // --- Handle result ---
      if (result && result.success) {
        this.context.storeResult(step.stepId, result);
        completed += 1;
        yield {
          type: 'step_complete',
          stepId: step.stepId,
          result,
          timestamp: Date.now(),
        };
      } else {
        circuitBreaker.recordFailure(breakerKey);
        skipped.add(step.stepId);

        const errorMsg =
          result?.error ??
          (lastError instanceof Error ? lastError.message : String(lastError));
        const dependents = this.findDependents(pipeline, step.stepId);
        dependents.forEach((d) => skipped.add(d));

        yield {
          type: 'step_error',
          stepId: step.stepId,
          error: errorMsg,
          errorType: classifyError(new Error(errorMsg)),
          skippedDependents: dependents,
          timestamp: Date.now(),
        };
      }
    }

    // --- Optional final synthesis ---
    if ((pipeline as PipelineDefinition & { finalSynthesis?: boolean }).finalSynthesis) {
      const narrative = await synthesizeNarrative(this.context, pipeline);
      yield { type: 'synthesis', narrative, timestamp: Date.now() };
    }

    yield { type: 'done', progress: { completed, total }, timestamp: Date.now() };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async executeStep(
    step: PipelineStep,
    parameters: Record<string, unknown>,
  ): Promise<AgentResult> {
    const input = this.resolveStepInput(step, parameters);
    const route = AGENT_ROUTING_MAP[step.intent];

    // PATH A — cortex_analyst
    if (route.type === 'cortex_analyst' || !route.cortexAgentName) {
      return analystAgent.execute(input);
    }

    // PATH B — cortex_agent (named Snowflake agent)
    const startMs = Date.now();
    const cortexRef = route.cortexAgentName;

    // Build enriched message including prior step summaries
    const enriched = this.enrichStepWithPriorResults(step, input.message);

    const agentMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: enriched },
    ];

    const response = await callCortexAgent(cortexRef, agentMessages);

    if (response.error) {
      return {
        success: false,
        error: response.error,
        durationMs: Date.now() - startMs,
        retryCount: 0,
      };
    }

    const artifact: AgentArtifact = {
      id: randomUUID(),
      agentName: cortexRef,
      intent: step.intent,
      data: response.data ?? null,
      sql: response.sql,
      narrative: response.text,
      createdAt: Date.now(),
      lineageId: randomUUID(),
      cacheStatus: 'miss',
    };

    return {
      success: true,
      artifact,
      durationMs: Date.now() - startMs,
      retryCount: 0,
    };
  }

  /**
   * Enrich a step's NL message with summaries from prior completed steps.
   * This gives named Cortex Agents the context they need when they depend on
   * upstream results (e.g. cluster assignments feeding a causal agent).
   */
  private enrichStepWithPriorResults(step: PipelineStep, baseMessage: string): string {
    if (step.dependsOn.length === 0) return baseMessage;

    const priorSummaries: string[] = [];
    let priorSQL: string | undefined;
    const priorData: Record<string, unknown> = {};

    for (const depId of step.dependsOn) {
      const depResult = this.context.getResult(depId);
      if (!depResult?.success) continue;

      const narrative = depResult.artifact?.narrative;
      const data = depResult.artifact?.data;
      const sql = depResult.artifact?.sql;

      if (sql && !priorSQL) priorSQL = sql;

      // Merge data fields for intent-specific enrichment hints
      if (data && typeof data === 'object') {
        Object.assign(priorData, data);
      }

      priorSummaries.push(summarizePriorResult(depId, narrative, data));
    }

    const priorNarrative = priorSummaries.join('\n');
    return enrichMessage(baseMessage, step.intent, { priorNarrative, priorSQL, priorData });
  }

  private resolveStepInput(
    step: PipelineStep,
    parameters: Record<string, unknown>,
  ): AgentInput {
    const resolvedMessage =
      (step.params?.['nlQuery'] as string) ??
      (parameters['nlQuery'] as string) ??
      step.description;

    return {
      message: resolvedMessage,
      intent: step.intent,
      sessionId: this.context.sessionId,
      userId: this.context.userId,
      semanticView: this.context.semanticView,
      conversationHistory: this.context.conversationHistory,
      userPreferences: this.context.userPreferences,
      extraContext: { ...(step.params ?? {}) },
    };
  }

  /** Returns all step IDs that (transitively) depend on the given stepId. */
  private findDependents(pipeline: PipelineDefinition, stepId: string): string[] {
    const dependents: string[] = [];
    for (const step of pipeline.steps) {
      if (step.dependsOn.includes(stepId)) {
        dependents.push(step.stepId);
        dependents.push(...this.findDependents(pipeline, step.stepId));
      }
    }
    return [...new Set(dependents)];
  }
}
