import { CacheManager } from '../../../../src/lib/agents/cache-manager';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

const ADMIN_ROLES = ['ADMIN', 'SYSADMIN', 'ACCOUNTADMIN'];

export async function POST(request: Request): Promise<Response> {
  const { userRole } = extractAuth(request);

  if (!ADMIN_ROLES.includes(userRole.toUpperCase())) {
    return Response.json({ error: 'Admin role required' }, { status: 403 });
  }

  let body: {
    key?: string;
    intent?: string;
    semanticViewId?: string;
    all?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { key, intent, semanticViewId, all } = body;

  try {
    const cache = CacheManager.getInstance();

    if (all) {
      await cache.invalidateAll();
    } else if (key) {
      await cache.invalidate(key);
    } else if (intent) {
      await cache.invalidateByIntent(intent);
    } else if (semanticViewId) {
      await cache.invalidateByViewId(semanticViewId);
    } else {
      return Response.json(
        { error: 'Provide at least one of: key, intent, semanticViewId, all' },
        { status: 400 },
      );
    }

    return Response.json({ invalidated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
