/**
 * RouteDispatcher — Blueprint v3.0 three-path orchestration entry point.
 *
 * Accepts a plain-text message, classifies intent, then routes via one of
 * three paths:
 *
 *   PATH A — cortex_analyst  → analystAgent.execute()
 *   PATH B — cortex_agent    → callCortexAgent() (named Snowflake agent)
 *   PATH C — pipeline        → PipelineExecutor (multi-step decomposition)
 *
 * The AGENT_ROUTING_MAP in agent-mapping.ts determines which path each
 * AgentIntent takes.  Named agents (PATH B) handle all SQL construction,
 * data preparation, and ML formatting internally — the web app only passes
 * the NL message and receives a structured response.
 */

import { randomUUID } from 'crypto';
import type {
  AgentIntent,
  AgentInput,
  AgentResult,
  AgentArtifact,
  DispatchEvent,
  FormattedResponse,
} from '../../types/agent';
import { ExecutionContext } from '../orchestrator/context';
import { synthesizer } from '../orchestrator/synthesizer';
import { classifyIntent } from './intent-classifier';
import { rateLimiter } from '../guardrails/rate-limiter';
import { costEstimator } from '../guardrails/cost-estimator';
import { lineageTracker } from '../lineage/lineage-tracker';
import { analystAgent } from '../agents/analyst-agent';
import { PipelineExecutor } from '../orchestrator/pipeline';
import { AGENT_ROUTING_MAP, enrichMessage } from '../agents/agent-mapping';
import { callCortexAgent } from '../snowflake/cortex-agent-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): number {
  return Date.now();
}

function baseEvent(
  type: DispatchEvent['type'],
  context: ExecutionContext,
): Omit<DispatchEvent, 'payload' | 'intent' | 'agentName' | 'error'> {
  return {
    type,
    sessionId: context.sessionId,
    userId: context.userId,
    timestamp: now(),
  };
}

/**
 * Convert a CortexAgentResponse into an AgentResult so downstream
 * synthesizer / lineage code can handle it identically to v2.x results.
 */
function buildAgentResult(
  agentRef: string,
  intent: AgentIntent,
  displayName: string,
  text: string,
  sql: string | undefined,
  data: unknown,
  executionTimeMs: number,
  lineageId: string,
  error?: string,
): AgentResult {
  if (error) {
    return {
      success: false,
      error,
      durationMs: executionTimeMs,
      retryCount: 0,
    };
  }

  // ── [FORECAST_LOG] Server-side diagnostic for forecast intents ──────────────
  if (intent.startsWith('FORECAST')) {
    console.log(`[FORECAST_LOG] intent=${intent} agent=${agentRef}`);
    console.log(`[FORECAST_LOG] text length=${text.length} chars`);
    console.log(`[FORECAST_LOG] text preview (first 300): ${text.slice(0, 300)}`);
    console.log(`[FORECAST_LOG] data type=${typeof data} isNull=${data == null}`);
    if (data != null && typeof data === 'object') {
      console.log(`[FORECAST_LOG] data keys=${JSON.stringify(Object.keys(data as object))}`);
      const d = data as Record<string, unknown>;
      if (Array.isArray(d['historical'])) console.log(`[FORECAST_LOG] historical rows=${(d['historical'] as unknown[]).length}`);
      if (Array.isArray(d['forecast']))   console.log(`[FORECAST_LOG] forecast rows=${  (d['forecast']   as unknown[]).length}`);
      if (Array.isArray(d['validation'])) console.log(`[FORECAST_LOG] validation rows=${(d['validation'] as unknown[]).length}`);
      if (d['metrics']) console.log(`[FORECAST_LOG] metrics=${JSON.stringify(d['metrics']).slice(0, 200)}`);
    }
    console.log(`[FORECAST_LOG] sql present=${!!sql}`);
  }
  // ────────────────────────────────────────────────────────────────────────────

  const artifact: AgentArtifact = {
    id: randomUUID(),
    agentName: agentRef,
    intent,
    data: data ?? null,
    sql,
    narrative: text,
    createdAt: now(),
    lineageId,
    cacheStatus: 'miss',
  };

  return {
    success: true,
    artifact,
    durationMs: executionTimeMs,
    retryCount: 0,
  };
}

// ---------------------------------------------------------------------------
// RouteDispatcher
// ---------------------------------------------------------------------------

export class RouteDispatcher {
  constructor(private context: ExecutionContext) {}

  async *dispatch(message: string, signal?: AbortSignal): AsyncGenerator<DispatchEvent> {
    const startMs = now();
    const reqId = startMs.toString(36);
    console.time(`TOTAL_REQUEST:${reqId}`);

    // -----------------------------------------------------------------------
    // 1. Classify intent
    // -----------------------------------------------------------------------
    yield {
      ...baseEvent('ROUTING', this.context),
      payload: { stage: 'classifying' },
    };

    const priorIntents = this.context.conversationHistory
      .filter((m) => m.role === 'assistant' && m.intent)
      .map((m) => m.intent as AgentIntent);

    console.time(`2_CLASSIFY_INTENT:${reqId}`);
    const classification = await classifyIntent({
      message,
      conversationContext: this.context.conversationHistory
        .slice(-6)
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n'),
      priorIntents,
    });
    console.timeEnd(`2_CLASSIFY_INTENT:${reqId}`);

    console.log(`[DISPATCHER] intent=${classification.intent} confidence=${classification.confidence} patterns=[${classification.matchedPatterns.join(', ')}]`);

    const intent: AgentIntent =
      classification.intent === 'UNKNOWN' ? 'ANALYST' : classification.intent;

    // Look up the route
    const route = AGENT_ROUTING_MAP[intent];
    const agentName = route.displayName;
    console.log(`[DISPATCHER] route: type=${route.type} agent=${route.cortexAgentName ?? 'n/a'} display="${agentName}"`);

    // -----------------------------------------------------------------------
    // 2. Routing event
    // -----------------------------------------------------------------------
    yield {
      ...baseEvent('ROUTING', this.context),
      intent,
      agentName,
      payload: {
        stage: 'routing',
        routingType: route.type,
        cortexAgentName: route.cortexAgentName,
        confidence: classification.confidence,
        matchedPatterns: classification.matchedPatterns,
      },
    };

    // -----------------------------------------------------------------------
    // 3. Rate limit check
    // -----------------------------------------------------------------------
    console.time(`3_RATE_LIMIT:${reqId}`);
    const rateLimitResult = await rateLimiter.checkAndConsume(this.context.userId);
    console.timeEnd(`3_RATE_LIMIT:${reqId}`);
    if (!rateLimitResult.allowed) {
      yield {
        ...baseEvent('ERROR', this.context),
        intent,
        agentName,
        error: rateLimitResult.reason ?? 'Rate limit exceeded.',
        payload: {
          retryAfterMs: rateLimitResult.retryAfterMs,
          remainingQueries: rateLimitResult.remainingQueries,
        },
      };
      return;
    }

    // -----------------------------------------------------------------------
    // 4. Cost estimate
    // -----------------------------------------------------------------------
    const costEstimate = costEstimator.estimate(intent, message, {});
    yield {
      ...baseEvent('ROUTING', this.context),
      intent,
      agentName,
      payload: {
        stage: 'cost_estimate',
        costEstimate,
        remainingCredits: rateLimitResult.remainingCredits,
      },
    };

    // -----------------------------------------------------------------------
    // 5. Build base AgentInput (used by PATH A and the pipeline path)
    // -----------------------------------------------------------------------
    const baseInput: AgentInput = {
      message,
      intent,
      sessionId: this.context.sessionId,
      userId: this.context.userId,
      semanticView: this.context.semanticView,
      conversationHistory: this.context.conversationHistory,
      userPreferences: this.context.userPreferences,
      extraContext: { abortSignal: signal, bypassCache: this.context.bypassCache ?? false },
    };

    // -----------------------------------------------------------------------
    // 6. Dispatch
    // -----------------------------------------------------------------------
    let result: AgentResult;

    try {
      // ─────────────────────────────────────────────────────────────────────
      // PATH C — pipeline (decompose into multiple steps)
      // ─────────────────────────────────────────────────────────────────────
      if (route.type === 'pipeline') {
        result = yield* this.dispatchPipeline(message, intent, agentName, baseInput, signal, startMs);
      }

      // ─────────────────────────────────────────────────────────────────────
      // PATH A — cortex_analyst
      // ─────────────────────────────────────────────────────────────────────
      else if (route.type === 'cortex_analyst') {
        yield { ...baseEvent('AGENT_START', this.context), intent, agentName };
        console.time(`5_ANALYST_AGENT:${reqId}`);
        result = await analystAgent.execute(baseInput);
        console.timeEnd(`5_ANALYST_AGENT:${reqId}`);
      }

      // ─────────────────────────────────────────────────────────────────────
      // PATH B — cortex_agent (named Snowflake agent)
      // ─────────────────────────────────────────────────────────────────────
      else {
        const cortexRef = route.cortexAgentName!;

        yield {
          ...baseEvent('AGENT_START', this.context),
          intent,
          agentName,
          payload: { stage: 'calling_cortex_agent', cortexAgentName: cortexRef },
        };

        // Build the message to send to the named agent.
        // If there is recent analyst SQL in context, include it so the named
        // agent can reference the data being discussed.
        const lastSQL = this.context.getLastAnalystSQL?.();
        const enriched = enrichMessage(message, intent, {
          priorSQL: lastSQL ?? undefined,
        });

        // Build conversation history for the named agent
        const agentMessages = this.buildAgentMessages(enriched);

        const lineageId = randomUUID();
        console.time(`5_CORTEX_AGENT:${reqId}`);
        const cortexResponse = await callCortexAgent(cortexRef, agentMessages, signal);
        console.timeEnd(`5_CORTEX_AGENT:${reqId}`);

        result = buildAgentResult(
          cortexRef,
          intent,
          agentName,
          cortexResponse.text,
          cortexResponse.sql,
          cortexResponse.data,
          cortexResponse.executionTimeMs,
          lineageId,
          cortexResponse.error,
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const errorMsg = err instanceof Error ? err.message : String(err);
      yield {
        ...baseEvent('AGENT_ERROR', this.context),
        intent,
        agentName,
        error: errorMsg,
      };
      return;
    }

    // -----------------------------------------------------------------------
    // 7. Emit agent complete
    // -----------------------------------------------------------------------
    if (!result.success && result.error) {
      yield {
        ...baseEvent('AGENT_ERROR', this.context),
        intent,
        agentName,
        error: result.error,
      };
      return;
    }

    // -----------------------------------------------------------------------
    // 8. Formatting
    // -----------------------------------------------------------------------
    yield {
      ...baseEvent('SYNTHESIS_START', this.context),
      intent,
      payload: { stage: 'formatting' },
    };

    console.time(`9_FORMAT:${reqId}`);
    const formatted = synthesizer.formatResult(result, intent);
    console.timeEnd(`9_FORMAT:${reqId}`);

    // -----------------------------------------------------------------------
    // 9. Record credit usage (non-blocking)
    // -----------------------------------------------------------------------
    rateLimiter.recordCreditUsage(this.context.userId, costEstimate.credits);

    // -----------------------------------------------------------------------
    // 10. Record lineage (non-blocking)
    // -----------------------------------------------------------------------
    lineageTracker.record({
      sessionId: this.context.sessionId,
      userId: this.context.userId,
      semanticViewId: this.context.semanticView.id,
      semanticViewName: this.context.semanticView.displayName,
      userQuestion: message,
      intent,
      agentName,
      executedSQL: result.artifact?.sql,
      rowCount: (() => {
        const d = result.artifact?.data as Record<string, unknown> | undefined;
        const rows = (d?.['results'] as { rows?: unknown[] } | undefined)?.rows;
        return Array.isArray(rows) ? rows.length : undefined;
      })(),
      executionTimeMs: now() - startMs,
      cacheStatus: result.artifact?.cacheStatus ?? 'miss',
      creditsConsumed: costEstimate.credits,
    });

    // -----------------------------------------------------------------------
    // 11. Build FormattedResponse
    // -----------------------------------------------------------------------
    const formattedResponse: FormattedResponse = synthesizer.toFormattedResponse(formatted, {
      sessionId: this.context.sessionId,
      intent,
      durationMs: now() - startMs,
      totalCostEstimate: {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: costEstimate.credits * 0.002,
        model: agentName,
      },
    });

    // -----------------------------------------------------------------------
    // 12. Add to conversation history
    // -----------------------------------------------------------------------
    this.context.addMessage({
      id: formattedResponse.id,
      role: 'assistant',
      content: formattedResponse.narrative,
      timestamp: now(),
      intent,
      artifactId: result.artifact?.id,
    });

    // -----------------------------------------------------------------------
    // 13. Emit complete
    // -----------------------------------------------------------------------
    console.timeEnd(`TOTAL_REQUEST:${reqId}`);
    yield {
      ...baseEvent('SYNTHESIS_COMPLETE', this.context),
      intent,
      agentName,
      payload: { result: formattedResponse },
    };
  }

  // ---------------------------------------------------------------------------
  // PATH C — pipeline
  // ---------------------------------------------------------------------------

  private async *dispatchPipeline(
    message: string,
    intent: AgentIntent,
    agentName: string,
    baseInput: AgentInput,
    signal: AbortSignal | undefined,
    startMs: number,
  ): AsyncGenerator<DispatchEvent, AgentResult> {
    // Decompose the request into a pipeline definition.
    // The LLM classifier will have set intent='PIPELINE' for complex multi-step
    // requests; here we build a minimal pipeline that covers the common cases.
    const { decomposeIntoPipeline } = await import('../llm/anthropic');

    let pipelineDef: Awaited<ReturnType<typeof decomposeIntoPipeline>> | null = null;
    try {
      pipelineDef = await decomposeIntoPipeline({
        message,
        semanticViewDisplayName: this.context.semanticView.displayName,
        conversationContext: this.context.conversationHistory
          .slice(-4)
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n'),
      });
    } catch { /* fall back to default 2-step pipeline */ }

    const pipeline = pipelineDef ?? this.buildDefaultPipeline(message);

    const executor = new PipelineExecutor(this.context);

    for await (const pipelineEvent of executor.execute(pipeline, { nlQuery: message })) {
      if (pipelineEvent.type === 'step_start') {
        yield {
          ...baseEvent('AGENT_START', this.context),
          intent,
          agentName: pipelineEvent.agentName,
          payload: { stepId: pipelineEvent.stepId },
        };
      } else if (pipelineEvent.type === 'step_complete') {
        yield {
          ...baseEvent('AGENT_COMPLETE', this.context),
          intent,
          agentName,
          payload: { stepId: pipelineEvent.stepId, result: pipelineEvent.result },
        };
      } else if (pipelineEvent.type === 'step_error') {
        yield {
          ...baseEvent('AGENT_ERROR', this.context),
          intent,
          agentName,
          error: pipelineEvent.error,
          payload: { stepId: pipelineEvent.stepId },
        };
      } else if (pipelineEvent.type === 'synthesis') {
        yield {
          ...baseEvent('SYNTHESIS_COMPLETE', this.context),
          intent,
          payload: { narrative: pipelineEvent.narrative },
        };
      }
    }

    // Return a synthetic AgentResult from the last completed step
    const lastResult = [...this.context.intermediateResults.values()].pop();
    return lastResult ?? {
      success: false,
      error: 'Pipeline produced no results.',
      durationMs: Date.now() - startMs,
      retryCount: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a default 2-step pipeline (ANALYST → FORECAST_AUTO) for the PIPELINE
   * intent when LLM decomposition is unavailable.
   */
  private buildDefaultPipeline(message: string) {
    const analystStepId = 'step_1_analyst';
    return {
      id: randomUUID(),
      name: 'Auto Pipeline',
      description: message.slice(0, 200),
      steps: [
        {
          stepId: analystStepId,
          intent: 'ANALYST' as AgentIntent,
          agentName: 'analyst',
          description: message.slice(0, 120),
          dependsOn: [],
          required: true,
        },
        {
          stepId: 'step_2_forecast',
          intent: 'FORECAST_AUTO' as AgentIntent,
          agentName: 'auto-forecast',
          description: 'Forecast the analyst results',
          dependsOn: [analystStepId],
          required: false,
        },
      ],
      parallelizable: false,
      createdAt: Date.now(),
      semanticViewDisplayName: this.context.semanticView.displayName,
    };
  }

  /**
   * Build the message array to send to a named Cortex Agent.
   * Includes the last few assistant turns as context.
   */
  private buildAgentMessages(
    currentMessage: string,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const history = this.context.conversationHistory.slice(-6);
    const agentMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const turn of history) {
      if (turn.role === 'user' || turn.role === 'assistant') {
        agentMessages.push({ role: turn.role, content: turn.content });
      }
    }

    agentMessages.push({ role: 'user', content: currentMessage });
    return agentMessages;
  }
}
