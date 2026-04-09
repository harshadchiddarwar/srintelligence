import { randomUUID } from 'crypto';
import { sessionStore } from '../../../../src/lib/session-store';
import { PipelineExecutor } from '../../../../src/lib/orchestrator/pipeline-executor';
import type { PipelineEvent } from '../../../../src/lib/orchestrator/pipeline';
import { ExecutionContext } from '../../../../src/lib/orchestrator/context';
import type { PipelineDefinition } from '../../../../src/types/agent';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

export async function POST(request: Request): Promise<Response> {
  const { userId, userRole } = extractAuth(request);

  let body: {
    pipelineDefinition: PipelineDefinition;
    parameters: Record<string, unknown>;
    sessionId?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { pipelineDefinition, parameters = {} } = body;

  if (!pipelineDefinition) {
    return Response.json({ error: 'pipelineDefinition is required' }, { status: 400 });
  }

  const sessionId = body.sessionId ?? randomUUID();

  const stored = sessionStore.get(userId, sessionId);
  const context: ExecutionContext = stored
    ? (stored.context as unknown as ExecutionContext)
    : new ExecutionContext({ sessionId, userId, userRole });

  const executor = new PipelineExecutor(context);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (event: PipelineEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const event of executor.execute(pipelineDefinition, parameters)) {
          send(event);
        }
      } catch (err) {
        const errorEvent: PipelineEvent = {
          type: 'step_error',
          stepId: 'pipeline',
          error: err instanceof Error ? err.message : String(err),
          errorType: 'PIPELINE_ERROR',
          skippedDependents: [],
          timestamp: Date.now(),
        };
        send(errorEvent);
      } finally {
        sessionStore.set(userId, sessionId, context as unknown as Record<string, unknown>);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Session-Id': sessionId,
    },
  });
}
