/**
 * PipelineExecutor — async generator that drives a multi-step agent pipeline,
 * honouring dependency ordering, circuit breaking, and retry logic.
 */

import type {
  AgentIntent,
  AgentResult,
  AgentInput,
  PipelineDefinition,
  PipelineStep,
} from '../../types/agent';
import { ExecutionContext } from './context';
import { RETRY_CONFIG, classifyError, isRetryable, circuitBreaker } from './error-handling';
import { analystAgent } from '../agents/analyst-agent';

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
// Lazy agent imports (agents are heavy — only load what we need)
// ---------------------------------------------------------------------------

async function resolveAgent(intent: AgentIntent) {
  switch (intent) {
    case 'ANALYST':
      return analystAgent;
    case 'FORECAST_PROPHET':
    case 'FORECAST_SARIMA':
    case 'FORECAST_HW':
    case 'FORECAST_XGB':
    case 'FORECAST_AUTO': {
      const { prophetAgent } = await import('../agents/prophet-agent');
      return prophetAgent;
    }
    case 'FORECAST_COMPARE': {
      // Fallback to prophet for compare — RouteDispatcher handles the real compare flow
      const { prophetAgent } = await import('../agents/prophet-agent');
      return prophetAgent;
    }
    default:
      return analystAgent;
  }
}

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
        const errorEvent: PipelineStepErrorEvent = {
          type: 'step_error',
          stepId: step.stepId,
          error: `Skipped because dependency failed: ${step.dependsOn.filter((d) => skipped.has(d)).join(', ')}`,
          errorType: 'DEPENDENCY_FAILED',
          skippedDependents: [step.stepId],
          timestamp: Date.now(),
        };
        yield errorEvent;
        continue;
      }

      // --- Check dependencies are satisfied ---
      const depsComplete = step.dependsOn.every((depId) =>
        this.context.getResult(depId) !== undefined,
      );
      if (!depsComplete) {
        skipped.add(step.stepId);
        const errorEvent: PipelineStepErrorEvent = {
          type: 'step_error',
          stepId: step.stepId,
          error: `Cannot run: unsatisfied dependencies: ${step.dependsOn.filter((d) => !this.context.getResult(d)).join(', ')}`,
          errorType: 'UNSATISFIED_DEPENDENCY',
          skippedDependents: [step.stepId],
          timestamp: Date.now(),
        };
        yield errorEvent;
        continue;
      }

      // --- Circuit breaker check ---
      const breakerKey = `pipeline:${step.agentName}`;
      if (circuitBreaker.isOpen(breakerKey)) {
        skipped.add(step.stepId);
        const errorEvent: PipelineStepErrorEvent = {
          type: 'step_error',
          stepId: step.stepId,
          error: `Circuit breaker open for agent '${step.agentName}' — too many recent failures.`,
          errorType: 'CIRCUIT_OPEN',
          skippedDependents: this.findDependents(pipeline, step.stepId),
          timestamp: Date.now(),
        };
        yield errorEvent;
        continue;
      }

      // --- Step start ---
      const startEvent: PipelineStepStartEvent = {
        type: 'step_start',
        stepId: step.stepId,
        agentName: step.agentName,
        timestamp: Date.now(),
      };
      yield startEvent;

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
        const completeEvent: PipelineStepCompleteEvent = {
          type: 'step_complete',
          stepId: step.stepId,
          result,
          timestamp: Date.now(),
        };
        yield completeEvent;
      } else {
        circuitBreaker.recordFailure(breakerKey);
        skipped.add(step.stepId);

        const errorMsg =
          result?.error ??
          (lastError instanceof Error ? lastError.message : String(lastError));
        const dependents = this.findDependents(pipeline, step.stepId);
        dependents.forEach((d) => skipped.add(d));

        const errorEvent: PipelineStepErrorEvent = {
          type: 'step_error',
          stepId: step.stepId,
          error: errorMsg,
          errorType: classifyError(new Error(errorMsg)),
          skippedDependents: dependents,
          timestamp: Date.now(),
        };
        yield errorEvent;
      }
    }

    // --- Optional final synthesis ---
    if ((pipeline as PipelineDefinition & { finalSynthesis?: boolean }).finalSynthesis) {
      const narrative = await synthesizeNarrative(this.context, pipeline);
      const synthesisEvent: PipelineSynthesisEvent = {
        type: 'synthesis',
        narrative,
        timestamp: Date.now(),
      };
      yield synthesisEvent;
    }

    const doneEvent: PipelineDoneEvent = {
      type: 'done',
      progress: { completed, total },
      timestamp: Date.now(),
    };
    yield doneEvent;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async executeStep(
    step: PipelineStep,
    parameters: Record<string, unknown>,
  ): Promise<AgentResult> {
    const input = this.resolveStepInput(step, parameters);
    const agent = await resolveAgent(step.intent);
    return agent.execute(input);
  }

  private resolveStepInput(
    step: PipelineStep,
    parameters: Record<string, unknown>,
  ): AgentInput {
    // Pull source SQL from a prior step if dependsOn specifies one
    let extraContext: Record<string, unknown> = { ...(step.params ?? {}) };

    if (step.dependsOn.length > 0) {
      const parentId = step.dependsOn[0];
      const parentResult = this.context.getResult(parentId);
      if (parentResult?.artifact?.sql) {
        extraContext = { ...extraContext, sourceSQL: parentResult.artifact.sql };
      }
    }

    // Apply parameter overrides from the run-time parameters bag
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
      extraContext,
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
