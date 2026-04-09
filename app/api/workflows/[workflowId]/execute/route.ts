import { randomUUID } from 'crypto';
import { workflowService } from '../../../../../src/lib/workflows/workflow-service';
import { PipelineExecutor } from '../../../../../src/lib/orchestrator/pipeline-executor';
import { ExecutionContext } from '../../../../../src/lib/orchestrator/context';
import type { PipelineEvent } from '../../../../../src/lib/orchestrator/pipeline';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
): Promise<Response> {
  const { workflowId } = await params;
  const { userId, userRole } = extractAuth(request);

  let body: { parameters?: Record<string, unknown>; versionId?: string } = {};

  try {
    body = await request.json();
  } catch {
    // body is optional
  }

  const { parameters = {}, versionId } = body;

  // 1. Check permission and load workflow
  let workflow: Awaited<ReturnType<typeof workflowService.getWorkflow>>;
  try {
    workflow = await workflowService.getWorkflow({ workflowId, userId, userRole });
    if (!workflow) {
      return Response.json({ error: 'Workflow not found' }, { status: 404 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 403 });
  }

  // Resolve pipeline from version or current workflow
  let pipelineDefinition = workflow.pipelineDefinition;
  if (versionId) {
    try {
      const version = await workflowService.getVersion({ workflowId, versionId: versionId!, userId });
      if (version) {
        pipelineDefinition = version.pipelineDefinitionSnapshot;
      }
    } catch {
      // use current pipeline if version lookup fails
    }
  }

  const sessionId = randomUUID();
  const executionId = randomUUID();

  // 3. Record execution start
  workflowService
    .recordExecutionStart({
      executionId,
      workflowId,
      workflowVersionId: versionId ?? 'current',
      triggerType: 'user',
      triggeredByUserId: userId,
      sessionId,
    })
    .catch(() => {});

  const context = new ExecutionContext({ sessionId, userId, userRole });
  const executor = new PipelineExecutor(context);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (event: PipelineEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let finalStatus: 'success' | 'failed' = 'success';
      let finalError: string | undefined;

      try {
        for await (const event of executor.execute(pipelineDefinition, parameters)) {
          send(event);
          if (event.type === 'step_error') {
            finalStatus = 'failed';
            finalError = (event as { error?: string }).error ?? 'Pipeline step failed';
          }
        }
      } catch (err) {
        finalStatus = 'failed';
        finalError = err instanceof Error ? err.message : String(err);
        const errorEvent: PipelineEvent = {
          type: 'step_error',
          stepId: 'pipeline',
          error: finalError,
          errorType: 'PIPELINE_ERROR',
          skippedDependents: [],
          timestamp: Date.now(),
        };
        send(errorEvent);
      } finally {
        // 5. Record execution complete
        workflowService
          .recordExecutionComplete({
            executionId,
            status: finalStatus,
            errorMessage: finalError,
          })
          .catch(() => {});
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Execution-Id': executionId,
      'X-Session-Id': sessionId,
    },
  });
}
