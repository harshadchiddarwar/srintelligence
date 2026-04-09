import { sessionStore } from '../../../../src/lib/session-store';
import { chatToPipeline } from '../../../../src/lib/orchestrator/chat-to-pipeline';
import { workflowService } from '../../../../src/lib/workflows/workflow-service';
import type { ConversationMessage } from '../../../../src/types/agent';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

export async function POST(request: Request): Promise<Response> {
  const { userId, userRole } = extractAuth(request);

  let body: { sessionId: string; name: string; description?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, name, description } = body;

  if (!sessionId?.trim()) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 });
  }
  if (!name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  // Load session
  const stored = sessionStore.get(userId, sessionId);
  if (!stored) {
    return Response.json({ error: 'Session not found or expired' }, { status: 404 });
  }

  const conversationHistory = (stored.context['messages'] ?? []) as ConversationMessage[];

  try {
    // Convert conversation history to a pipeline definition
    const pipelineDefinition = await chatToPipeline(conversationHistory);

    // Create workflow from the pipeline
    const workflow = await workflowService.createWorkflow({
      name,
      description,
      pipelineDefinition,
    }, userId);

    return Response.json({ workflow }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
