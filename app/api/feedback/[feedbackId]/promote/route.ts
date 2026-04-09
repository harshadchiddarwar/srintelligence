import { feedbackService } from '../../../../../src/lib/feedback/feedback-service';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

const ADMIN_ROLES = ['ADMIN', 'SYSADMIN', 'ACCOUNTADMIN'];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ feedbackId: string }> },
): Promise<Response> {
  const { feedbackId } = await params;
  const { userRole } = extractAuth(request);

  if (!ADMIN_ROLES.includes(userRole.toUpperCase())) {
    return Response.json({ error: 'Admin role required' }, { status: 403 });
  }

  try {
    const result = await feedbackService.promoteSQLCorrection(feedbackId);
    return Response.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
