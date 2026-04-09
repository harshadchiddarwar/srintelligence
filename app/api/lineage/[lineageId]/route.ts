import { LineageTracker } from '../../../../src/lib/agents/lineage-tracker';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lineageId: string }> },
): Promise<Response> {
  const { lineageId } = await params;

  try {
    const lineage = await LineageTracker.getInstance().getLineage(lineageId);
    if (!lineage) {
      return Response.json({ error: 'Lineage record not found' }, { status: 404 });
    }
    return Response.json({ lineage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
