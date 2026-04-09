import { randomUUID } from 'crypto';
import { workflowService } from '../../../../src/lib/workflows/workflow-service';
import { PipelineExecutor } from '../../../../src/lib/orchestrator/pipeline-executor';
import { ExecutionContext } from '../../../../src/lib/orchestrator/context';

export async function POST(request: Request): Promise<Response> {
  // 1. Verify webhook secret
  const webhookSecret = request.headers.get('x-webhook-secret');
  const expectedSecret = process.env.WEBHOOK_SECRET;

  if (!expectedSecret || webhookSecret !== expectedSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse body
  let body: {
    scheduleId: string;
    workflowId: string;
    versionId?: string;
    parameters?: Record<string, unknown>;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { scheduleId, workflowId, versionId, parameters = {} } = body;

  if (!scheduleId?.trim() || !workflowId?.trim()) {
    return Response.json({ error: 'scheduleId and workflowId are required' }, { status: 400 });
  }

  // 3. Respond 202 immediately
  const executionId = randomUUID();
  const sessionId = randomUUID();

  // 4. Run async in the background — fire and forget
  setImmediate(async () => {
    try {
      const schedule = await workflowService.getSchedule({
        workflowId,
        userId: 'scheduler',
        userRole: process.env.SCHEDULER_ROLE ?? 'APP_SVC_ROLE',
      });

      const userId = schedule?.runAsUserId ?? 'scheduler';
      const userRole = schedule?.runAsRole ?? process.env.SCHEDULER_ROLE ?? 'APP_SVC_ROLE';

      const workflow = await workflowService.getWorkflow({ workflowId, userId, userRole });
      if (!workflow) return;

      let pipelineDefinition = workflow.pipelineDefinition;
      const resolvedVersionId = versionId ?? (schedule?.useLatestVersion ? undefined : versionId);

      if (resolvedVersionId) {
        try {
          const version = await workflowService.getVersion({
            workflowId,
            versionId: resolvedVersionId,
            userId,
          });
          if (version) {
            pipelineDefinition = version.pipelineDefinitionSnapshot;
          }
        } catch {
          // use current pipeline
        }
      }

      await workflowService.recordExecutionStart({
        executionId,
        workflowId,
        workflowVersionId: resolvedVersionId ?? 'current',
        triggerType: 'schedule',
        triggeredByUserId: userId,
        sessionId,
      });

      const context = new ExecutionContext({ sessionId, userId, userRole });
      const executor = new PipelineExecutor(context);

      let finalStatus: 'success' | 'failed' = 'success';
      let finalError: string | undefined;

      try {
        for await (const event of executor.execute(pipelineDefinition, parameters)) {
          if (event.type === 'step_error') {
            finalStatus = 'failed';
            finalError = (event as { error?: string }).error ?? 'Pipeline step failed';
          }
        }
      } catch (err) {
        finalStatus = 'failed';
        finalError = err instanceof Error ? err.message : String(err);
      }

      await workflowService.recordExecutionComplete({
        executionId,
        status: finalStatus,
        errorMessage: finalError,
      });
    } catch (err) {
      console.error('[scheduler/trigger] Background execution failed:', err);
    }
  });

  return Response.json({ accepted: true, executionId, sessionId }, { status: 202 });
}
