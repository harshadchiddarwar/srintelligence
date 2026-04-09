import { workflowService } from '../../../src/lib/workflows/workflow-service';
import type { PipelineDefinition } from '../../../src/types/agent';
import type { WorkflowCategory } from '../../../src/types/workflow';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

export async function GET(request: Request): Promise<Response> {
  const { userId, userRole } = extractAuth(request);

  try {
    const workflows = await workflowService.listWorkflows({ userId, userRole });
    return Response.json({ workflows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const { userId, userRole } = extractAuth(request);

  let body: {
    name: string;
    description?: string;
    pipelineDefinition: PipelineDefinition;
    category?: WorkflowCategory;
    icon?: string;
    tags?: string[];
    isTemplate?: boolean;
    isPublic?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, description, pipelineDefinition, category, icon, tags, isTemplate, isPublic } =
    body;

  if (!name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  if (!pipelineDefinition) {
    return Response.json({ error: 'pipelineDefinition is required' }, { status: 400 });
  }

  try {
    const workflow = await workflowService.createWorkflow({
      name,
      description,
      pipelineDefinition,
      category,
      icon,
      tags,
      isTemplate,
      isPublic,
      ownerId: userId,
    }, userId);
    return Response.json({ workflow }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
