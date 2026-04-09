import { workflowService } from '../../../../src/lib/workflows/workflow-service';
import type { PipelineDefinition } from '../../../../src/types/agent';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
): Promise<Response> {
  const { workflowId } = await params;
  const { userId, userRole } = extractAuth(request);

  try {
    const workflow = await workflowService.getWorkflow({ workflowId, userId, userRole });
    if (!workflow) {
      return Response.json({ error: 'Workflow not found' }, { status: 404 });
    }
    return Response.json({ workflow });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
): Promise<Response> {
  const { workflowId } = await params;
  const { userId, userRole } = extractAuth(request);

  let body: {
    name?: string;
    description?: string;
    pipelineDefinition?: PipelineDefinition;
    tags?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const workflow = await workflowService.updateWorkflow({
      workflowId,
      userId,
      userRole,
      name: body.name,
      description: body.description,
      tags: body.tags,
      pipelineDefinition: body.pipelineDefinition,
    });
    return Response.json({ workflow });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
): Promise<Response> {
  const { workflowId } = await params;
  const { userId, userRole } = extractAuth(request);

  try {
    await workflowService.archiveWorkflow({ workflowId, userId });
    return Response.json({ archived: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
