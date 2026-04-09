import { executeSQL } from '../../../../src/lib/snowflake/sql-api';
import { CacheManager } from '../../../../src/lib/agents/cache-manager';
import { feedbackService } from '../../../../src/lib/feedback/feedback-service';

const MONITORING_ROLE = process.env.MONITORING_ROLE ?? 'APP_SVC_ROLE';

async function querySafe(viewName: string): Promise<Record<string, unknown>[]> {
  try {
    const result = await executeSQL(`SELECT * FROM ${viewName} LIMIT 500`, MONITORING_ROLE);
    return result.rows;
  } catch {
    return [];
  }
}

export async function GET(): Promise<Response> {
  try {
    const [
      executionHealth,
      workflowHealth,
      agentHealth,
      feedbackSummary,
      cacheEffectiveness,
      creditUsage,
      cacheStats,
      feedbackStats,
    ] = await Promise.all([
      querySafe('CORTEX_TESTING.PUBLIC.V_EXECUTION_HEALTH'),
      querySafe('CORTEX_TESTING.PUBLIC.V_WORKFLOW_HEALTH'),
      querySafe('CORTEX_TESTING.PUBLIC.V_AGENT_HEALTH'),
      querySafe('CORTEX_TESTING.PUBLIC.V_FEEDBACK_SUMMARY'),
      querySafe('CORTEX_TESTING.PUBLIC.V_CACHE_EFFECTIVENESS'),
      querySafe('CORTEX_TESTING.PUBLIC.V_CREDIT_USAGE_DAILY'),
      Promise.resolve(CacheManager.getInstance().getStats()).catch(() => null),
      feedbackService.getFeedbackStats().catch(() => null),
    ]);

    return Response.json({
      executionHealth,
      workflowHealth,
      agentHealth,
      feedbackSummary,
      cacheEffectiveness,
      creditUsage,
      cacheStats,
      feedbackStats,
      generatedAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
