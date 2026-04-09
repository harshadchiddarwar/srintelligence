/**
 * RouteDispatcher — main orchestration entry point.
 *
 * Accepts a plain-text message, classifies intent, selects the right agent
 * (or pipeline), executes it, formats the result, and streams progress events
 * back to the caller via an async generator.
 */

import type {
  AgentIntent,
  AgentInput,
  AgentResult,
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

/** Lazily load a forecast agent by intent. */
async function loadForecastAgent(intent: AgentIntent) {
  switch (intent) {
    case 'FORECAST_PROPHET': {
      const { prophetAgent } = await import('../agents/prophet-agent');
      return prophetAgent;
    }
    case 'FORECAST_SARIMA': {
      const { sarimaAgent } = await import('../agents/sarima-agent');
      return sarimaAgent;
    }
    case 'FORECAST_HW': {
      const { hwAgent } = await import('../agents/hw-agent');
      return hwAgent;
    }
    case 'FORECAST_XGB': {
      const { xgboostAgent } = await import('../agents/xgboost-agent');
      return xgboostAgent;
    }
    case 'FORECAST_AUTO':
    default: {
      const { prophetAgent } = await import('../agents/prophet-agent');
      return prophetAgent;
    }
  }
}

// ---------------------------------------------------------------------------
// RouteDispatcher
// ---------------------------------------------------------------------------

export class RouteDispatcher {
  constructor(private context: ExecutionContext) {}

  async *dispatch(message: string): AsyncGenerator<DispatchEvent> {
    const startMs = now();

    // -----------------------------------------------------------------------
    // 1. Classifying
    // -----------------------------------------------------------------------
    yield {
      ...baseEvent('ROUTING', this.context),
      payload: { stage: 'classifying' },
    };

    const priorIntents = this.context.conversationHistory
      .filter((m) => m.role === 'assistant' && m.intent)
      .map((m) => m.intent as AgentIntent);

    const classification = await classifyIntent({
      message,
      conversationContext: this.context.conversationHistory
        .slice(-6)
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n'),
      priorIntents,
    });

    const intent: AgentIntent =
      classification.intent === 'UNKNOWN' ? 'ANALYST' : classification.intent;

    const agentName = this.intentToAgentName(intent);

    // -----------------------------------------------------------------------
    // 2. Routing event
    // -----------------------------------------------------------------------
    yield {
      ...baseEvent('ROUTING', this.context),
      intent,
      agentName,
      payload: {
        stage: 'routing',
        confidence: classification.confidence,
        matchedPatterns: classification.matchedPatterns,
      },
    };

    // -----------------------------------------------------------------------
    // 3. Rate limit check
    // -----------------------------------------------------------------------
    const rateLimitResult = await rateLimiter.checkAndConsume(this.context.userId);
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
    // 5. Build base AgentInput
    // -----------------------------------------------------------------------
    const baseInput: AgentInput = {
      message,
      intent,
      sessionId: this.context.sessionId,
      userId: this.context.userId,
      semanticView: this.context.semanticView,
      conversationHistory: this.context.conversationHistory,
      userPreferences: this.context.userPreferences,
    };

    // -----------------------------------------------------------------------
    // 6. Route by intent
    // -----------------------------------------------------------------------
    let result: AgentResult;

    try {
      switch (intent) {
        // -------------------------------------------------------------------
        // ANALYST — direct execution
        // -------------------------------------------------------------------
        case 'ANALYST': {
          yield { ...baseEvent('AGENT_START', this.context), intent, agentName };
          result = await analystAgent.execute(baseInput);
          break;
        }

        // -------------------------------------------------------------------
        // FORECAST_* (single model)
        // -------------------------------------------------------------------
        case 'FORECAST_PROPHET':
        case 'FORECAST_SARIMA':
        case 'FORECAST_HW':
        case 'FORECAST_XGB':
        case 'FORECAST_AUTO': {
          yield {
            ...baseEvent('AGENT_START', this.context),
            intent,
            agentName,
            payload: { stage: 'preparing_data' },
          };

          const preparedData = await analystAgent.prepareDataForDownstreamAgent({
            userQuestion: message,
            targetAgent: intent,
            context: baseInput,
          });

          if (preparedData.error || !preparedData.sql) {
            yield {
              ...baseEvent('AGENT_ERROR', this.context),
              intent,
              agentName,
              error: preparedData.error ?? 'Could not prepare data for forecast.',
            };
            return;
          }

          yield {
            ...baseEvent('AGENT_START', this.context),
            intent,
            agentName,
            payload: { stage: 'executing', sourceSQL: preparedData.sql },
          };

          const forecastAgent = await loadForecastAgent(intent);
          result = await forecastAgent.execute({
            ...baseInput,
            extraContext: {
              sourceSQL: preparedData.sql,
              dateCol: preparedData.dateCol,
              valueCol: preparedData.valueCol,
              parentLineageId: preparedData.lineageId,
            },
          });
          break;
        }

        // -------------------------------------------------------------------
        // FORECAST_COMPARE
        // -------------------------------------------------------------------
        case 'FORECAST_COMPARE': {
          yield {
            ...baseEvent('AGENT_START', this.context),
            intent,
            agentName,
            payload: { stage: 'preparing_data' },
          };

          const preparedData = await analystAgent.prepareDataForDownstreamAgent({
            userQuestion: message,
            targetAgent: 'FORECAST_COMPARE',
            context: baseInput,
          });

          if (preparedData.error || !preparedData.sql) {
            yield {
              ...baseEvent('AGENT_ERROR', this.context),
              intent,
              agentName,
              error: preparedData.error ?? 'Could not prepare data for forecast comparison.',
            };
            return;
          }

          yield {
            ...baseEvent('AGENT_START', this.context),
            intent,
            agentName,
            payload: { stage: 'executing' },
          };

          const { forecastCompareAgent } = await import('../agents/forecast-compare-agent');
          result = await forecastCompareAgent.execute({
            ...baseInput,
            extraContext: {
              sourceSQL: preparedData.sql,
              dateCol: preparedData.dateCol,
              valueCol: preparedData.valueCol,
              parentLineageId: preparedData.lineageId,
            },
          });
          break;
        }

        // -------------------------------------------------------------------
        // MTREE
        // -------------------------------------------------------------------
        case 'MTREE': {
          yield {
            ...baseEvent('AGENT_START', this.context),
            intent,
            agentName,
            payload: { stage: 'preparing_data' },
          };

          const preparedData = await analystAgent.prepareDataForDownstreamAgent({
            userQuestion: message,
            targetAgent: 'MTREE',
            context: baseInput,
          });

          if (preparedData.error || !preparedData.sql) {
            yield {
              ...baseEvent('AGENT_ERROR', this.context),
              intent,
              agentName,
              error: preparedData.error ?? 'Could not prepare data for metric tree analysis.',
            };
            return;
          }

          yield {
            ...baseEvent('AGENT_START', this.context),
            intent,
            agentName,
            payload: { stage: 'executing' },
          };

          const { mtreeAgent } = await import('../agents/mtree-agent');
          result = await mtreeAgent.execute({
            ...baseInput,
            extraContext: {
              sourceSQL: preparedData.sql,
              parentLineageId: preparedData.lineageId,
            },
          });
          break;
        }

        // -------------------------------------------------------------------
        // CLUSTER
        // -------------------------------------------------------------------
        case 'CLUSTER': {
          yield {
            ...baseEvent('AGENT_START', this.context),
            intent,
            agentName,
            payload: { stage: 'preparing_data' },
          };

          const preparedData = await analystAgent.prepareDataForDownstreamAgent({
            userQuestion: message,
            targetAgent: 'CLUSTER',
            context: baseInput,
          });

          if (preparedData.error || !preparedData.sql) {
            yield {
              ...baseEvent('AGENT_ERROR', this.context),
              intent,
              agentName,
              error: preparedData.error ?? 'Could not prepare data for clustering.',
            };
            return;
          }

          yield {
            ...baseEvent('AGENT_START', this.context),
            intent,
            agentName,
            payload: { stage: 'executing' },
          };

          const { clusteringAgent } = await import('../agents/clustering-agent');
          result = await clusteringAgent.execute({
            ...baseInput,
            extraContext: {
              sourceSQL: preparedData.sql,
              parentLineageId: preparedData.lineageId,
            },
          });
          break;
        }

        // -------------------------------------------------------------------
        // PIPELINE — decompose and run via PipelineExecutor
        // -------------------------------------------------------------------
        case 'PIPELINE': {
          // Build a minimal pipeline: ANALYST step followed by FORECAST_AUTO step
          const { randomUUID } = await import('crypto');
          const analystStepId = 'step_1_analyst';
          const pipeline = {
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
            finalSynthesis: true,
          };

          const executor = new PipelineExecutor(this.context);

          for await (const pipelineEvent of executor.execute(pipeline, { nlQuery: message })) {
            // Forward pipeline events as AGENT_* dispatch events
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

          // For PIPELINE return a synthetic AgentResult from the last step
          const lastStepResult = [...this.context.intermediateResults.values()].pop();
          if (lastStepResult) {
            result = lastStepResult;
          } else {
            result = {
              success: false,
              error: 'Pipeline produced no results.',
              durationMs: now() - startMs,
              retryCount: 0,
            };
          }
          break;
        }

        // -------------------------------------------------------------------
        // UNKNOWN — fall back to ANALYST
        // -------------------------------------------------------------------
        default: {
          yield { ...baseEvent('AGENT_START', this.context), intent: 'ANALYST', agentName: 'analyst' };
          result = await analystAgent.execute({ ...baseInput, intent: 'ANALYST' });
          break;
        }
      }
    } catch (err) {
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
    // 7. Formatting
    // -----------------------------------------------------------------------
    yield {
      ...baseEvent('SYNTHESIS_START', this.context),
      intent,
      payload: { stage: 'formatting' },
    };

    const formatted = synthesizer.formatResult(result, intent);

    // -----------------------------------------------------------------------
    // 8. Record credit usage (non-blocking)
    // -----------------------------------------------------------------------
    rateLimiter.recordCreditUsage(this.context.userId, costEstimate.credits);

    // -----------------------------------------------------------------------
    // 9. Record lineage (non-blocking)
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
      rowCount: Array.isArray(result.artifact?.data) ? result.artifact.data.length : undefined,
      executionTimeMs: now() - startMs,
      cacheStatus: result.artifact?.cacheStatus ?? 'miss',
      creditsConsumed: costEstimate.credits,
    }).catch(() => { /* non-blocking */ });

    // -----------------------------------------------------------------------
    // 10. Build the full FormattedResponse
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
    // 11. Add assistant message to context history
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
    // 12. Emit complete event
    // -----------------------------------------------------------------------
    yield {
      ...baseEvent('SYNTHESIS_COMPLETE', this.context),
      intent,
      agentName,
      payload: { result: formattedResponse },
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private intentToAgentName(intent: AgentIntent): string {
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
}
