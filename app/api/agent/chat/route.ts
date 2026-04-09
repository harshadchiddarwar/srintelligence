import { randomUUID } from 'crypto';
import { sessionStore } from '../../../../src/lib/session-store';
import { RouteDispatcher } from '../../../../src/lib/router/route-dispatcher';
import { ExecutionContext } from '../../../../src/lib/orchestrator/context';
import {
  discoverSemanticViews,
  getDefaultSemanticView,
  getSemanticViewById,
} from '../../../../src/lib/snowflake/semantic-discovery';
import type { DispatchEvent } from '../../../../src/types/agent';

// Helper: extract auth headers with defaults
function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

// Detect "switch to <view name>" commands
function parseSwitchCommand(message: string): string | null {
  const match = message.match(/^switch\s+to\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function POST(request: Request): Promise<Response> {
  const { userId, userRole } = extractAuth(request);

  let body: {
    message: string;
    sessionId?: string;
    semanticViewId?: string;
    bypassCache?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { message, bypassCache = false } = body;

  if (!message?.trim()) {
    return Response.json({ error: 'message is required' }, { status: 400 });
  }

  const sessionId = body.sessionId ?? randomUUID();

  // Load or create ExecutionContext
  const stored = sessionStore.get(userId, sessionId);
  const context: ExecutionContext = stored
    ? (stored.context as unknown as ExecutionContext)
    : new ExecutionContext({ sessionId, userId, userRole });

  // Resolve semantic view
  let semanticView: import('../../../../src/types/agent').SemanticViewRef | null = context.semanticView ?? null;

  const switchTarget = parseSwitchCommand(message);
  if (switchTarget) {
    // "switch to X" — find view by display name or id
    const views = await discoverSemanticViews(userRole);
    const matched =
      views.find((v) => v.displayName.toLowerCase() === switchTarget.toLowerCase()) ??
      views.find((v) => v.id.toLowerCase() === switchTarget.toLowerCase());
    if (matched) {
      semanticView = matched;
      context.semanticView = matched;
    }
  } else if (body.semanticViewId && !semanticView) {
    semanticView = await getSemanticViewById(body.semanticViewId);
  }

  if (!semanticView) {
    semanticView = await getDefaultSemanticView(userRole);
  }

  if (!semanticView) {
    // Last resort: pick first available view
    const views = await discoverSemanticViews(userRole);
    semanticView = views[0] ?? null;
  }

  if (!semanticView) {
    return Response.json({ error: 'No semantic view available for role' }, { status: 503 });
  }

  if (semanticView) context.semanticView = semanticView;
  context.bypassCache = bypassCache;

  const dispatcher = new RouteDispatcher(context);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (event: DispatchEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const event of dispatcher.dispatch(message)) {
          send(event);
        }
      } catch (err) {
        const errorEvent: DispatchEvent = {
          type: 'ERROR',
          sessionId,
          userId,
          timestamp: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        };
        send(errorEvent);
      } finally {
        // Persist context back to session store
        sessionStore.set(userId, sessionId, context as unknown as Record<string, unknown>);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Session-Id': sessionId,
    },
  });
}
