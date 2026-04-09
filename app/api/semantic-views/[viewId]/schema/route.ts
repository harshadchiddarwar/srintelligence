import { getSemanticViewById } from '../../../../../src/lib/snowflake/semantic-discovery';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ viewId: string }> },
): Promise<Response> {
  const { viewId } = await params;

  try {
    const view = await getSemanticViewById(viewId);
    if (!view) {
      return Response.json({ error: 'Semantic view not found' }, { status: 404 });
    }
    return Response.json({ view });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
