import { workflowService } from '../../../../src/lib/workflows/workflow-service';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

export async function GET(request: Request): Promise<Response> {
  const { userId, userRole } = extractAuth(request);

  try {
    const workflows = await workflowService.listWorkflows({
      userId,
      userRole,
      filter: { status: 'active' },
    });
    return Response.json({ workflows });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
