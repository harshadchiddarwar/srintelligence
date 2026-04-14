import { getSemanticViewById } from '../../../../../src/lib/snowflake/semantic-discovery';
import { executeSQL } from '../../../../../src/lib/snowflake/sql-api';

function parseDbSchema(fqn: string): { db: string; schema: string } | null {
  // Remove @ prefix for stage-based names: @DB.SCHEMA.stage/yaml → DB.SCHEMA...
  const cleaned = fqn.startsWith('@') ? fqn.slice(1) : fqn;
  const parts = cleaned.split('.');
  if (parts.length < 2) return null;
  return { db: parts[0].toUpperCase(), schema: parts[1].toUpperCase() };
}

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

    const parsed = parseDbSchema(view.fullyQualifiedName);
    if (!parsed) {
      return Response.json({ columns: [] });
    }

    const { db, schema } = parsed;
    const sql = `
      SELECT DISTINCT COLUMN_NAME, DATA_TYPE
      FROM ${db}.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${schema}'
      ORDER BY COLUMN_NAME ASC
    `;

    const result = await executeSQL(sql);
    const columns = result.rows.map((r) => String(r['COLUMN_NAME'] ?? r['column_name'] ?? ''));

    return Response.json({ columns });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message, columns: [] }, { status: 500 });
  }
}
