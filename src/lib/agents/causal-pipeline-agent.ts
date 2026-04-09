/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * CausalPipelineAgent — runs the full end-to-end causal inference pipeline via
 * the CORTEX_TESTING.ML.RUN_CAUSAL_PIPELINE stored procedure.
 *
 * SQL pattern (ALWAYS use CALL for procedures, NEVER SELECT * FROM TABLE()):
 *   CALL CORTEX_TESTING.ML.RUN_CAUSAL_PIPELINE(
 *     source_table,
 *     outcome_col,
 *     treatment_col,
 *     period_col,
 *     baseline_period,
 *     target_period,
 *     output_table
 *   )
 *
 * After the CALL completes, we SELECT from the output table to retrieve results.
 *
 * The procedure writes its output to a user-specified results table, then this
 * agent reads from that table and surfaces all causal sub-results in a single artifact.
 */

import { randomUUID } from 'crypto';
import { executeSQL } from '../snowflake/sql-api';
import type {
  AgentInput,
  AgentResult,
  AgentArtifact,
  AgentIntent,
} from '../../types/agent';

// ---------------------------------------------------------------------------
// CausalPipelineAgent
// ---------------------------------------------------------------------------

export class CausalPipelineAgent {
  readonly name = 'causal-pipeline';
  readonly displayName = 'Causal Inference Pipeline';
  readonly description =
    'Runs the full end-to-end causal inference pipeline (contribution + drivers + validation + narrative) via CALL CORTEX_TESTING.ML.RUN_CAUSAL_PIPELINE.';
  readonly intent: AgentIntent = 'CAUSAL_PIPELINE';

  async execute(input: AgentInput): Promise<AgentResult> {
    const startTime = Date.now();
    const lineageId = randomUUID();
    const abortSignal = input.extraContext?.abortSignal as AbortSignal | undefined;

    // ------------------------------------------------------------------
    // Validate required parameters
    // ------------------------------------------------------------------
    const ctx = input.extraContext ?? {};
    const sourceSQL = ctx.sourceSQL as string | undefined;
    const outcomeCol = ctx.outcomeCol as string | undefined;
    const treatmentCol = ctx.treatmentCol as string | undefined;

    if (!sourceSQL || !sourceSQL.trim()) {
      return this.makeErrorResult('sourceSQL must be a non-empty SQL string.', 'VALIDATION_ERROR', startTime, lineageId);
    }
    if (!outcomeCol) {
      return this.makeErrorResult('outcomeCol is required.', 'VALIDATION_ERROR', startTime, lineageId);
    }
    if (!treatmentCol) {
      return this.makeErrorResult('treatmentCol is required.', 'VALIDATION_ERROR', startTime, lineageId);
    }

    const periodCol = (ctx.periodCol as string | undefined) ?? 'PERIOD';
    const baselinePeriod = (ctx.baselinePeriod as string | undefined) ?? 'baseline';
    const targetPeriod = (ctx.targetPeriod as string | undefined) ?? 'target';

    // Use a unique temp output table name scoped to this run
    const outputTable = `CORTEX_TESTING.ML.CAUSAL_RESULTS_${randomUUID().replace(/-/g, '_').toUpperCase()}`;

    // ------------------------------------------------------------------
    // Step 1: Materialise sourceSQL into a temp table for the procedure
    // ------------------------------------------------------------------
    const stagingTable = `CORTEX_TESTING.ML.CAUSAL_STAGING_${randomUUID().replace(/-/g, '_').toUpperCase()}`;
    const createStaging = `CREATE TEMP TABLE ${stagingTable} AS\n${sourceSQL.trim()}`;

    try {
      await executeSQL(createStaging, undefined, abortSignal);
    } catch (err) {
      return this.makeErrorResult(
        `Failed to stage source data: ${err instanceof Error ? err.message : String(err)}`,
        'SQL_EXECUTION_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // Step 2: CALL the pipeline procedure (NEVER use SELECT * FROM TABLE())
    // ------------------------------------------------------------------
    const callSQL = [
      `CALL CORTEX_TESTING.ML.RUN_CAUSAL_PIPELINE(`,
      `  '${stagingTable}',`,
      `  '${outcomeCol}',`,
      `  '${treatmentCol}',`,
      `  '${periodCol}',`,
      `  '${baselinePeriod}',`,
      `  '${targetPeriod}',`,
      `  '${outputTable}'`,
      `)`,
    ].join('\n');

    try {
      await executeSQL(callSQL, undefined, abortSignal);
    } catch (err) {
      return this.makeErrorResult(
        `Causal pipeline CALL failed: ${err instanceof Error ? err.message : String(err)}`,
        'SQL_EXECUTION_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // Step 3: Read results from the output table
    // ------------------------------------------------------------------
    let pipelineRows: Record<string, unknown>[] = [];
    try {
      const pipelineResult = await executeSQL(
        `SELECT * FROM ${outputTable} ORDER BY RESULT_TYPE, RANK`,
        undefined,
        abortSignal,
      );
      pipelineRows = pipelineResult.rows;
    } catch (err) {
      return this.makeErrorResult(
        `Failed to read pipeline output: ${err instanceof Error ? err.message : String(err)}`,
        'SQL_EXECUTION_ERROR',
        startTime,
        lineageId,
      );
    }

    // ------------------------------------------------------------------
    // Clean up temp tables (non-blocking)
    // ------------------------------------------------------------------
    Promise.all([
      executeSQL(`DROP TABLE IF EXISTS ${stagingTable}`).catch(() => {}),
      executeSQL(`DROP TABLE IF EXISTS ${outputTable}`).catch(() => {}),
    ]).catch(() => {});

    // ------------------------------------------------------------------
    // Parse and structure the pipeline output
    // ------------------------------------------------------------------
    const grouped: Record<string, Record<string, unknown>[]> = {};
    for (const row of pipelineRows) {
      const resultType = String(row['RESULT_TYPE'] ?? 'UNKNOWN');
      if (!grouped[resultType]) grouped[resultType] = [];
      grouped[resultType].push(row);
    }

    const narrative =
      `Full causal inference pipeline complete. ` +
      `${pipelineRows.length} result row(s) across ${Object.keys(grouped).length} section(s): ` +
      Object.keys(grouped).join(', ') + '.';

    const artifact: AgentArtifact = {
      id: randomUUID(),
      agentName: this.name,
      intent: this.intent,
      data: {
        type: 'causal',
        subtype: 'pipeline',
        sections: grouped,
        totalRows: pipelineRows.length,
        outcomeCol,
        treatmentCol,
      },
      narrative,
      createdAt: Date.now(),
      lineageId,
      cacheStatus: 'miss',
    };

    const result: AgentResult = {
      success: true,
      artifact,
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };

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
    return { success: false, artifact, error, durationMs: 0, retryCount: 0 };
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
    } catch { /* non-blocking */ }
  }
}

export const causalPipelineAgent = new CausalPipelineAgent();
