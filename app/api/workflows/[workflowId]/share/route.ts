import { workflowService } from '../../../../../src/lib/workflows/workflow-service';
import type { SharePermission } from '../../../../../src/types/workflow';

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
    const shares = await workflowService.listShares({ workflowId, userId, userRole });
    return Response.json({ shares });
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
    sharedWithUserId?: string;
    sharedWithRole?: string;
    permission: SharePermission;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.permission) {
    return Response.json({ error: 'permission is required' }, { status: 400 });
  }

  if (!body.sharedWithUserId && !body.sharedWithRole) {
    return Response.json(
      { error: 'sharedWithUserId or sharedWithRole is required' },
      { status: 400 },
    );
  }

  try {
    const share = await workflowService.addShare({
      workflowId,
      grantedBy: userId,
      userRole,
      sharedWithUserId: body.sharedWithUserId,
      sharedWithRole: body.sharedWithRole,
      permission: body.permission,
    });
    return Response.json({ share }, { status: 201 });
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

  const url = new URL(request.url);
  const shareId = url.searchParams.get('shareId');

  if (!shareId) {
    return Response.json({ error: 'shareId query param is required' }, { status: 400 });
  }

  try {
    await workflowService.removeShare({ workflowId, shareId, userId, userRole });
    return Response.json({ removed: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
