/**
 * @deprecated Blueprint v3.0 — This SQL-building agent is superseded by the
 * corresponding named Snowflake Cortex Agent (SRI_FORECAST_AGENT,
 * SRI_CLUSTERING_AGENT, SRI_META_TREE, or SRI_CAUSAL_INFERENCE_AGENT).
 * Named agents handle all SQL construction, data preparation, and ML
 * formatting internally.  This file is kept for reference only and is no
 * longer invoked by the v3.0 dispatcher or pipeline executor.
 */

/**
 * CausalNarrativeAgent — generates a plain-language executive narrative from
 * causal inference results via CORTEX_TESTING.ML.CAUSAL_NARRATIVE table-valued function.
 *
 * SQL pattern (ALWAYS use TABLE(), NEVER CALL):
 *   SELECT * FROM TABLE(CORTEX_TESTING.ML.CAUSAL_NARRATIVE(
 *     CURSOR(SELECT * FROM causal_results)
 *   ))
 *
 * sourceSQL is expected to be the output of a prior causal function
 * (CAUSAL_CONTRIBUTION, CAUSAL_DRIVERS, or CAUSAL_VALIDATION).
 *
 * Output columns:
 *   SECTION VARCHAR, NARRATIVE VARCHAR, CONFIDENCE VARCHAR
 */

import type { AgentInput, AgentIntent } from '../../types/agent';
import { BaseAgent, type ParsedData, type ValidationResult } from './base-agent';

export class CausalNarrativeAgent extends BaseAgent {
  readonly name = 'causal-narrative';
  readonly displayName = 'Causal Narrative';
  readonly description =
    'Generates a plain-language executive narrative from causal analysis results using CORTEX_TESTING.ML.CAUSAL_NARRATIVE.';
  readonly intent: AgentIntent = 'CAUSAL_NARRATIVE';

  validateInput(input: AgentInput): ValidationResult {
    const sourceSQL = input.extraContext?.sourceSQL as string | undefined;
    if (!sourceSQL || !sourceSQL.trim()) {
      return { valid: false, error: 'sourceSQL must be a non-empty SQL string (causal results).' };
    }
    return { valid: true };
  }

  buildSQL(input: AgentInput): string {
    const sourceSQL = input.extraContext!.sourceSQL as string;

    return [
      `WITH CAUSAL_RESULTS AS (`,
      sourceSQL.trim(),
      `)`,
      `SELECT * FROM TABLE(CORTEX_TESTING.ML.CAUSAL_NARRATIVE(`,
      `  CURSOR(SELECT * FROM CAUSAL_RESULTS)`,
      `))`,
      `ORDER BY SECTION`,
    ].join('\n');
  }

  parseResults(
    rows: Record<string, unknown>[],
    _columns: string[],
    _input: AgentInput,
  ): ParsedData {
    if (rows.length === 0) {
      return {
        data: { type: 'causal', sections: [], fullNarrative: 'No narrative generated.' },
        narrative: 'Causal narrative returned no results.',
        metadata: { rowCount: 0 },
      };
    }

    const sections = rows.map((row) => ({
      section: String(row['SECTION'] ?? row['section'] ?? ''),
      narrative: String(row['NARRATIVE'] ?? row['narrative'] ?? ''),
      confidence: String(row['CONFIDENCE'] ?? row['confidence'] ?? ''),
    }));

    const fullNarrative = sections.map((s) => s.narrative).filter(Boolean).join('\n\n');

    return {
      data: {
        type: 'causal',
        subtype: 'narrative',
        sections,
        fullNarrative,
      },
      narrative: fullNarrative || 'Causal narrative generated.',
      metadata: { rowCount: rows.length, sectionCount: sections.length },
    };
  }
}

export const causalNarrativeAgent = new CausalNarrativeAgent();
