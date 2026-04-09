import { userService } from '../../../../src/lib/users/user-service';
import type { UserPreferences } from '../../../../src/types/user';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

export async function GET(request: Request): Promise<Response> {
  const { userId } = extractAuth(request);

  try {
    const preferences = await userService.getPreferences(userId);
    return Response.json({ preferences });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const { userId } = extractAuth(request);

  let body: Partial<UserPreferences>;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const preferences = await userService.updatePreferences(userId, body);
    return Response.json({ preferences });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
