/**
 * ResponseSynthesizer — formats AgentResult into a rich FormattedResponse
 * using template-based narratives per agent intent.
 */

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// stripAgentPreamble — remove "I'll/Let me/I will/I'm going to..." sentences
// that the Cortex agent emits before its actual analysis output.
// These are planning sentences like:
//   "I'll segment physicians using GMM clustering with 2 clusters..."
//   "Let me construct the appropriate clustering query."
// We strip them so only the substantive result text reaches the chat UI.
// ---------------------------------------------------------------------------
function stripAgentPreamble(text: string): string {
  const lines = text.split('\n');
  const outputLines: string[] = [];
  let foundContent = false;

  const PREAMBLE_RE = /^\s*(?:I[''](?:ll|m|ve|d)|Let me|I will|I'm going to|I am going to|I'll be|Sure[,!]|Of course[,!]|Certainly[,!]|Sure thing[,!])\b/i;

  for (const line of lines) {
    if (!foundContent) {
      // Skip blank lines before content starts
      if (line.trim() === '') continue;
      // Skip lines that are purely agent preamble / planning
      if (PREAMBLE_RE.test(line)) continue;
      // Anything else — real content starts here
      foundContent = true;
    }
    outputLines.push(line);
  }
  return outputLines.join('\n');
}
import type {
  AgentResult,
  AgentIntent,
  AgentArtifact,
  FormattedResponse,
  CostEstimate,
} from '../../types/agent';

// ---------------------------------------------------------------------------
// FormattedResponse shape (local alias for clarity)
// ---------------------------------------------------------------------------

export interface FormattedResponseLocal {
  text: string;
  artifacts: AgentArtifact[];
  suggestedFollowUps: string[];
  lineageId: string;
  cacheStatus: string;
}

// ---------------------------------------------------------------------------
// Per-intent follow-up templates
// ---------------------------------------------------------------------------

const CLUSTER_FOLLOW_UPS = [
  'What are the key traits of cluster 1?',
  'Show Z-scores for all clusters.',
  'How many records are in each cluster?',
  'Which cluster is highest value?',
  'Export cluster assignments.',
];

const CAUSAL_FOLLOW_UPS = [
  'Which driver had the largest impact?',
  'Run the causal validation tests.',
  'Generate a narrative summary of these results.',
  'Compare causal vs correlational drivers.',
  'What is the confidence level for each finding?',
];

const FOLLOW_UPS: Record<AgentIntent, string[]> = {
  ANALYST: [
    'Can you break this down by region?',
    'Show me the top 10 contributors.',
    'What is the year-over-year change?',
    'Filter this to the last 90 days.',
    'Export these results to a chart.',
  ],
  FORECAST_PROPHET: [
    'How confident is the forecast?',
    'Show me the weekly trend decomposition.',
    'Compare Prophet vs SARIMA for this metric.',
    'Extend the forecast to 6 months.',
    'What are the seasonal components?',
  ],
  FORECAST_SARIMA: [
    'What SARIMA order was selected?',
    'How does this compare to Prophet?',
    'Show the residual diagnostics.',
    'Extend the forecast to 6 months.',
    'What are the seasonal components?',
  ],
  FORECAST_HW: [
    'What smoothing parameters were used?',
    'Compare Holt-Winters vs SARIMA.',
    'Show the trend and seasonality components.',
    'Extend the forecast to Q4.',
    'How does accuracy compare to last quarter?',
  ],
  FORECAST_XGB: [
    'Which features drove the forecast?',
    'Show feature importances.',
    'Compare XGBoost vs Prophet for this metric.',
    'Extend the forecast to 6 months.',
    'What lag features were included?',
  ],
  FORECAST_HYBRID: [
    'What weights were assigned to each model?',
    'Compare Hybrid vs Prophet for this metric.',
    'Show the ensemble confidence intervals.',
    'Extend the hybrid forecast to 6 months.',
    'Which sub-model contributed most to accuracy?',
  ],
  FORECAST_AUTO: [
    'Which model was selected automatically?',
    'Show the model selection criteria.',
    'Compare all candidate models.',
    'Extend the best model forecast.',
    'What evaluation metric was used?',
  ],
  FORECAST_COMPARE: [
    'Which model should I use going forward?',
    'Show confidence intervals for each model.',
    'Run the winning model for a longer horizon.',
    'What drove the accuracy differences?',
    'Export the comparison table.',
  ],
  MTREE: [
    'Which segment contributed most to the change?',
    'Drill into the top driver.',
    'Show a waterfall chart of contributions.',
    'Compare to the previous period.',
    'Which segments are underperforming?',
  ],
  CLUSTER: CLUSTER_FOLLOW_UPS,
  CLUSTER_GM: CLUSTER_FOLLOW_UPS,
  CLUSTER_DBSCAN: [
    'How many noise/outlier points were found?',
    'Adjust the eps parameter and re-run.',
    ...CLUSTER_FOLLOW_UPS.slice(0, 3),
  ],
  CLUSTER_HIERARCHICAL: [
    'Can I see the dendrogram?',
    'Change the linkage method to complete.',
    ...CLUSTER_FOLLOW_UPS.slice(0, 3),
  ],
  CLUSTER_KMEANS: CLUSTER_FOLLOW_UPS,
  CLUSTER_KMEDOIDS: [
    'Which records are the medoids?',
    ...CLUSTER_FOLLOW_UPS.slice(0, 4),
  ],
  CLUSTER_COMPARE: [
    'Run the winning clustering algorithm.',
    'Show silhouette scores for all algorithms.',
    'How does GMM compare to K-Means here?',
    'Export the comparison table.',
    'Which algorithm is best for my use case?',
  ],
  CAUSAL_AUTO: CAUSAL_FOLLOW_UPS,
  CAUSAL_CONTRIBUTION: [
    'Which driver contributed most positively?',
    'Which driver contributed most negatively?',
    'Validate these causal assumptions.',
    'Generate a narrative from these results.',
    'Compare this period to the previous one.',
  ],
  CAUSAL_DRIVERS: [
    'Which drivers are statistically significant?',
    'Show effect sizes for each driver.',
    'Run validation tests on these findings.',
    'Generate a narrative summary.',
    'Which drivers can I act on?',
  ],
  CAUSAL_VALIDATION: [
    'Which tests failed and why?',
    'What do I need to fix before drawing conclusions?',
    'Run the causal drivers analysis.',
    'Show the parallel trends plot.',
    'What is the recommended next step?',
  ],
  CAUSAL_NARRATIVE: [
    'Can you make this more concise?',
    'Add recommendations based on these findings.',
    'Translate this for a non-technical audience.',
    'Which findings should I prioritize?',
    'Export this as a report.',
  ],
  CAUSAL_PIPELINE: [
    'Which step of the pipeline took longest?',
    'Show the contribution analysis results.',
    'Show the validation test results.',
    'Generate an executive narrative.',
    'Re-run with different baseline/target periods.',
  ],
  PIPELINE: [
    'Run this pipeline on a different date range.',
    'Show the execution timeline.',
    'Which step took the longest?',
    'Save this as a scheduled workflow.',
    'Share these results with my team.',
  ],
  UNKNOWN: [
    'Can you rephrase your question?',
    'Try asking about a specific metric.',
    'What dataset would you like to explore?',
  ],
};

// ---------------------------------------------------------------------------
// ResponseSynthesizer
// ---------------------------------------------------------------------------

export class ResponseSynthesizer {
  /**
   * Formats a raw AgentResult into a display-ready FormattedResponseLocal.
   */
  formatResult(result: AgentResult, intent: AgentIntent): FormattedResponseLocal {
    const artifact = result.artifact;
    const lineageId = artifact?.lineageId ?? 'unknown';
    const cacheStatus = artifact?.cacheStatus ?? 'miss';
    const artifacts = artifact ? [artifact] : [];

    const text = this.buildNarrative(result, intent);
    const suggestedFollowUps = this.generateSuggestedFollowUps(
      intent,
      Array.isArray(artifact?.data) ? (artifact.data as Record<string, unknown>[]) : undefined,
    );

    return { text, artifacts, suggestedFollowUps, lineageId, cacheStatus };
  }

  /**
   * Builds the markdown narrative for a result.
   */
  private buildNarrative(result: AgentResult, intent: AgentIntent): string {
    if (!result.success) {
      return `**Error:** ${result.error ?? 'An unknown error occurred.'}\n\nPlease try rephrasing your question or contact support if this persists.`;
    }

    const artifact = result.artifact;
    const base = artifact?.narrative ?? '_No narrative was generated for this result._';

    switch (intent) {
      case 'ANALYST': {
        return base;
      }

      case 'FORECAST_PROPHET':
      case 'FORECAST_SARIMA':
      case 'FORECAST_HW':
      case 'FORECAST_XGB':
      case 'FORECAST_AUTO': {
        const modelLabel = intent.replace('FORECAST_', '');
        return [
          `### ${modelLabel} Forecast`,
          '',
          base,
          '',
          `_Model: ${modelLabel} • duration: ${result.durationMs}ms • cache: ${artifact?.cacheStatus ?? 'miss'}_`,
        ].join('\n');
      }

      case 'FORECAST_HYBRID': {
        return [
          '### Hybrid Ensemble Forecast',
          '',
          base,
          '',
          `_Model: Hybrid Ensemble • duration: ${result.durationMs}ms • cache: ${artifact?.cacheStatus ?? 'miss'}_`,
        ].join('\n');
      }

      case 'FORECAST_COMPARE': {
        return [
          '### Model Comparison',
          '',
          base,
          '',
          `_All forecast models evaluated • duration: ${result.durationMs}ms_`,
        ].join('\n');
      }

      case 'MTREE': {
        return [
          '### Metric Tree Analysis',
          '',
          base,
          '',
          `_Decomposition complete • duration: ${result.durationMs}ms • cache: ${artifact?.cacheStatus ?? 'miss'}_`,
        ].join('\n');
      }

      case 'CLUSTER':
      case 'CLUSTER_GM':
      case 'CLUSTER_DBSCAN':
      case 'CLUSTER_HIERARCHICAL':
      case 'CLUSTER_KMEANS':
      case 'CLUSTER_KMEDOIDS': {
        const algo = intent === 'CLUSTER' ? 'GMM' : intent.replace('CLUSTER_', '');
        // Strip any planning/thinking sentences the Cortex agent prepends before its results
        const cleanBase = stripAgentPreamble(base);
        return [
          `### ${algo} Cluster Profiles`,
          '',
          cleanBase,
          '',
          `_Algorithm: ${algo} • duration: ${result.durationMs}ms • cache: ${artifact?.cacheStatus ?? 'miss'}_`,
        ].join('\n');
      }

      case 'CLUSTER_COMPARE': {
        return [
          '### Clustering Algorithm Comparison',
          '',
          base,
          '',
          `_All algorithms evaluated • duration: ${result.durationMs}ms_`,
        ].join('\n');
      }

      case 'CAUSAL_AUTO':
      case 'CAUSAL_CONTRIBUTION': {
        return [
          '### Causal Contribution Analysis',
          '',
          base,
          '',
          `_Causal decomposition complete • duration: ${result.durationMs}ms_`,
        ].join('\n');
      }

      case 'CAUSAL_DRIVERS': {
        return [
          '### Causal Driver Analysis',
          '',
          base,
          '',
          `_Driver identification complete • duration: ${result.durationMs}ms_`,
        ].join('\n');
      }

      case 'CAUSAL_VALIDATION': {
        return [
          '### Causal Assumption Validation',
          '',
          base,
          '',
          `_Validation tests complete • duration: ${result.durationMs}ms_`,
        ].join('\n');
      }

      case 'CAUSAL_NARRATIVE': {
        return [
          '### Causal Narrative',
          '',
          base,
          '',
          `_Narrative generated • duration: ${result.durationMs}ms_`,
        ].join('\n');
      }

      case 'CAUSAL_PIPELINE': {
        return [
          '### Full Causal Inference Pipeline',
          '',
          base,
          '',
          `_End-to-end pipeline complete • duration: ${result.durationMs}ms_`,
        ].join('\n');
      }

      default:
        return base;
    }
  }

  /**
   * Returns 3–5 intent-specific follow-up suggestions.
   */
  generateSuggestedFollowUps(
    intent: AgentIntent,
    data?: Record<string, unknown>[],
  ): string[] {
    const base = FOLLOW_UPS[intent] ?? FOLLOW_UPS.UNKNOWN;

    // For ANALYST we can personalise suggestions based on column names
    if (intent === 'ANALYST' && data && data.length > 0) {
      const cols = Object.keys(data[0]);
      const hasDate = cols.some((c) => /date|week|month|year|period/i.test(c));
      const hasGeo = cols.some((c) => /region|country|state|city|market/i.test(c));
      const extras: string[] = [];
      if (hasDate) extras.push('Show me the trend over time.');
      if (hasGeo) extras.push('Break this down by geography.');
      return [...extras, ...base].slice(0, 5);
    }

    return base.slice(0, 5);
  }

  /**
   * Converts a FormattedResponseLocal into a full FormattedResponse for the API layer.
   */
  toFormattedResponse(
    local: FormattedResponseLocal,
    params: {
      sessionId: string;
      intent: AgentIntent;
      durationMs: number;
      totalCostEstimate: CostEstimate;
    },
  ): FormattedResponse {
    return {
      id: randomUUID(),
      sessionId: params.sessionId,
      intent: params.intent,
      narrative: local.text,
      artifacts: local.artifacts,
      suggestions: local.suggestedFollowUps,
      totalCostEstimate: params.totalCostEstimate,
      durationMs: params.durationMs,
      lineageId: local.lineageId,
      createdAt: Date.now(),
    };
  }
}

export const synthesizer = new ResponseSynthesizer();
