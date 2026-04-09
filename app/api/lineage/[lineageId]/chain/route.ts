import { LineageTracker } from '../../../../../src/lib/agents/lineage-tracker';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lineageId: string }> },
): Promise<Response> {
  const { lineageId } = await params;

  try {
    const chain = await LineageTracker.getInstance().getLineageChain(lineageId);
    return Response.json({ chain });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
