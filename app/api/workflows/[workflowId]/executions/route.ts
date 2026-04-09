import { workflowService } from '../../../../../src/lib/workflows/workflow-service';

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

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? '20');
  const offset = Number(url.searchParams.get('offset') ?? '0');

  try {
    const executions = await workflowService.getExecutionHistory({
      workflowId,
      userId,
      limit: isNaN(limit) ? 20 : limit,
      offset: isNaN(offset) ? 0 : offset,
    });
    return Response.json({ executions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
