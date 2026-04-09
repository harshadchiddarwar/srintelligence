import { CacheManager } from '../../../src/lib/agents/cache-manager';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

export async function GET(): Promise<Response> {
  try {
    const stats = CacheManager.getInstance().getStats();
    return Response.json({ stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  extractAuth(request); // reserved for future permission checks

  const url = new URL(request.url);
  const all = url.searchParams.get('all');
  const intent = url.searchParams.get('intent');
  const viewId = url.searchParams.get('viewId');
  const key = url.searchParams.get('key');

  try {
    const cache = CacheManager.getInstance();

    if (all === 'true') {
      await cache.invalidateAll();
    } else if (intent) {
      await cache.invalidateByIntent(intent);
    } else if (viewId) {
      await cache.invalidateByViewId(viewId);
    } else if (key) {
      await cache.invalidate(key);
    } else {
      return Response.json(
        { error: 'Provide ?all=true, ?intent=X, ?viewId=Y, or ?key=Z' },
        { status: 400 },
      );
    }

    return Response.json({ invalidated: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
