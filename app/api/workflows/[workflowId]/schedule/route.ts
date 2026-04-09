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

  try {
    const schedule = await workflowService.getSchedule({ workflowId, userId, userRole });
    return Response.json({ schedule });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workflowId: string }> },
): Promise<Response> {
  const { workflowId } = await params;
  const { userId, userRole } = extractAuth(request);

  let body: {
    cronExpression: string;
    timezone: string;
    runAsUserId?: string;
    runAsRole?: string;
    useLatestVersion?: boolean;
    notifyOnSuccess?: boolean;
    notifyOnFailure?: boolean;
    notificationEmails?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.cronExpression?.trim()) {
    return Response.json({ error: 'cronExpression is required' }, { status: 400 });
  }
  if (!body.timezone?.trim()) {
    return Response.json({ error: 'timezone is required' }, { status: 400 });
  }

  try {
    const schedule = await workflowService.upsertSchedule({
      workflowId,
      createdBy: userId,
      userRole,
      ...body,
    });
    return Response.json({ schedule });
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
    await workflowService.deactivateSchedule({ workflowId, userId, userRole });
    return Response.json({ deactivated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
