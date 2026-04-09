/**
 * ForecastCompareAgent — runs all four forecast models in parallel and produces
 * a comparison table artifact identifying the best-performing model by MAPE.
 *
 * Does NOT extend BaseAgent because it delegates to the four specialist agents
 * rather than executing its own SQL. Uses Promise.allSettled so that a single
 * model failure does not prevent the others from completing.
 */

import { randomUUID } from 'crypto';
import { prophetAgent } from './prophet-agent';
import { sarimaAgent } from './sarima-agent';
import { hwAgent } from './hw-agent';
import { xgboostAgent } from './xgboost-agent';
import type {
  AgentInput,
  AgentResult,
  AgentArtifact,
  AgentIntent,
} from '../../types/agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelSummary {
  modelName: string;
  displayName: string;
  success: boolean;
  mape?: number;
  mae?: number;
  lastForecastValue?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// ForecastCompareAgent
// ---------------------------------------------------------------------------

export class ForecastCompareAgent {
  readonly name = 'forecast-compare';
  readonly displayName = 'Forecast Model Comparison';
  readonly description =
    'Runs Prophet, SARIMA, Holt-Winters, and XGBoost in parallel and compares accuracy metrics to identify the best model.';
  readonly intent: AgentIntent = 'FORECAST_COMPARE';

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    const lineageId = randomUUID();

    // Validate that sourceSQL is present before fanning out
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return this.makeErrorResult(
        'sourceSQL must be a non-empty SQL string.',
        'VALIDATION_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // Run all four models in parallel
    // ------------------------------------------------------------------
    const [prophetSettled, sarimaSettled, hwSettled, xgbSettled] =
      await Promise.allSettled([
        prophetAgent.execute(input),
        sarimaAgent.execute(input),
        hwAgent.execute(input),
        xgboostAgent.execute(input),
      ]);

    const settled = [
      { agent: prophetAgent, result: prophetSettled },
      { agent: sarimaAgent, result: sarimaSettled },
      { agent: hwAgent, result: hwSettled },
      { agent: xgboostAgent, result: xgbSettled },
    ];

    // ------------------------------------------------------------------
    // Extract metrics from each result
    // ------------------------------------------------------------------
    const summaries: ModelSummary[] = settled.map(({ agent, result }) => {
      if (result.status === 'rejected') {
        return {
          modelName: agent.name,
          displayName: agent.displayName,
          success: false,
          error: String(result.reason),
        };
      }

      const agentResult = result.value;

      if (!agentResult.success || !agentResult.artifact) {
        return {
          modelName: agent.name,
          displayName: agent.displayName,
          success: false,
          error: agentResult.error ?? 'Unknown failure',
        };
      }

      // Dig into the artifact data shape produced by our forecast agents
      const data = agentResult.artifact.data as Record<string, unknown> | null | undefined;
      const metrics = data?.metrics as Record<string, unknown> | undefined;
      const forecast = data?.forecast as Record<string, unknown>[] | undefined;

      const mape = toNumber(metrics?.mape);
      const mae = toNumber(metrics?.mae);
      const lastRow = Array.isArray(forecast) ? forecast[forecast.length - 1] : undefined;
      const lastForecastValue = lastRow
        ? toNumber(lastRow['YHAT'] ?? lastRow['yhat'])
        : undefined;

      return {
        modelName: agent.name,
        displayName: agent.displayName,
        success: true,
        mape: mape ?? undefined,
        mae: mae ?? undefined,
        lastForecastValue: lastForecastValue ?? undefined,
      };
    });

    // ------------------------------------------------------------------
    // Identify winner (lowest MAPE among successful models)
    // ------------------------------------------------------------------
    const successful = summaries.filter(
      (s): s is ModelSummary & { success: true; mape: number } =>
        s.success && s.mape !== undefined,
    );

    const winner =
      successful.length > 0
        ? successful.reduce((best, cur) => (cur.mape < best.mape ? cur : best))
        : null;

    const successCount = summaries.filter((s) => s.success).length;

    const narrative =
      winner
        ? `Comparison across ${successCount} models complete. Best model: ${winner.displayName} (MAPE: ${(winner.mape * 100).toFixed(1)}%).`
        : successCount > 0
          ? `${successCount} models completed but none returned MAPE metrics.`
          : 'All forecast models failed. Check sourceSQL and Snowflake connectivity.';

    // ------------------------------------------------------------------
    // Build comparison artifact
    // ------------------------------------------------------------------
    const artifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: {
        type: 'forecast_comparison',
        models: summaries,
        winner: winner
          ? {
              modelName: winner.modelName,
              displayName: winner.displayName,
              mape: winner.mape,
              mae: winner.mae,
            }
          : null,
        successCount,
        failureCount: summaries.length - successCount,
      },
      narrative,
      createdAt: Date.now(),
      lineageId,
      cacheStatus: 'miss',
    };

    const result: AgentResult = {
      success: successCount > 0,
      artifact,
      error: successCount === 0 ? 'All forecast models failed' : undefined,
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };

    // ------------------------------------------------------------------
    // Lineage (non-blocking)
    // ------------------------------------------------------------------
    this.recordLineage(input, lineageId).catch(() => {});

    return result;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private makeErrorResult(
    error: string,
    errorType: string,
    startTime: number,
    lineageId: string,
  ): AgentResult {
    const artifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: null,
      narrative: `Error (${errorType}): ${error}`,
      createdAt: Date.now(),
      lineageId,
      cacheStatus: 'error',
    };
    return {
      success: false,
      artifact,
      error,
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };
  }

  private async recordLineage(input: AgentInput, lineageId: string): Promise<void> {
    try {
      const { LineageTracker } = await import('./lineage-tracker');
      await LineageTracker.getInstance().record({
        lineageId,
        sessionId: input.sessionId,
        userId: input.userId,
        intent: this.intent,
        agentName: this.name,
      });
    } catch {
      // Lineage recording failure must never surface to the caller
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const forecastCompareAgent = new ForecastCompareAgent();
