import { feedbackService } from '../../../../src/lib/feedback/feedback-service';

export async function GET(): Promise<Response> {
  try {
    const stats = await feedbackService.getFeedbackStats();
    return Response.json({ stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
