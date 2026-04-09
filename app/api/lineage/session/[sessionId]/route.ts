import { LineageTracker } from '../../../../../src/lib/agents/lineage-tracker';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await params;

  try {
    const lineages = await LineageTracker.getInstance().getSessionLineage(sessionId);
    return Response.json({ lineages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
