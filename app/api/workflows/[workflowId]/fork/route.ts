import { workflowService } from '../../../../../src/lib/workflows/workflow-service';

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

  let body: { name: string };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    const workflow = await workflowService.forkWorkflow({
      workflowId,
      name: body.name,
      newOwnerId: userId,
      userRole,
    });
    return Response.json({ workflow }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
