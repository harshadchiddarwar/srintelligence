import { feedbackService } from '../../../src/lib/feedback/feedback-service';
import type { FeedbackRating, FeedbackCategory } from '../../../src/types/user';

function extractAuth(request: Request): { userId: string; userRole: string } {
  const userId = request.headers.get('x-user-id') ?? 'harshad@sr.com';
  const userRole = request.headers.get('x-user-role') ?? 'APP_SVC_ROLE';
  return { userId, userRole };
}

export async function POST(request: Request): Promise<Response> {
  const { userId } = extractAuth(request);

  let body: {
    executionId?: string;
    lineageId?: string;
    stepId?: string;
    agentName: string;
    rating: FeedbackRating;
    category: FeedbackCategory;
    comment?: string;
    sqlCorrection?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.agentName?.trim()) {
    return Response.json({ error: 'agentName is required' }, { status: 400 });
  }
  if (!body.rating) {
    return Response.json({ error: 'rating is required' }, { status: 400 });
  }
  if (!body.category) {
    return Response.json({ error: 'category is required' }, { status: 400 });
  }

  try {
    const feedback = await feedbackService.submitFeedback({
      userId,
      ...body,
    });
    return Response.json({ feedback }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<Response> {
  const { userId } = extractAuth(request);

  const url = new URL(request.url);
  const agentName = url.searchParams.get('agentName') ?? undefined;
  const startDate = url.searchParams.get('startDate') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : 50;

  try {
    const records = await feedbackService.getFeedback({
      userId,
      agentName,
      startDate,
      limit: isNaN(limit) ? 50 : limit,
    });
    return Response.json({ records });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
