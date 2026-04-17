import { getSemanticViewById } from '../../../../../src/lib/snowflake/semantic-discovery';
import { executeSQL } from '../../../../../src/lib/snowflake/sql-api';
import { load as parseYaml } from 'js-yaml';

// ---------------------------------------------------------------------------
// Stage reference parser
// ---------------------------------------------------------------------------

interface StageRef { db: string; schema: string; stage: string; file: string }

/**
 * Parse a Cortex Analyst semantic model FQN such as
 * `@CORTEX_TESTING.PUBLIC.STAGE_NAME/analytics_model.yaml`
 * into its constituent parts.
 */
function parseStageRef(fqn: string): StageRef | null {
  // Strip leading "@" if present
  const cleaned = fqn.startsWith('@') ? fqn.slice(1) : fqn;
  const slashIdx = cleaned.indexOf('/');
  if (slashIdx === -1) return null;
  const parts = cleaned.slice(0, slashIdx).split('.');
  if (parts.length < 3) return null;
  return {
    db:     parts[0].toUpperCase(),
    schema: parts[1].toUpperCase(),
    stage:  parts[2].toUpperCase(),
    file:   cleaned.slice(slashIdx + 1),
  };
}

// ---------------------------------------------------------------------------
// Cortex Analyst YAML → table names
// ---------------------------------------------------------------------------

interface CortexYaml {
  tables?: Array<{
    base_table?: { database?: string; schema?: string; table?: string };
  }>;
}

function extractTableNamesFromYaml(yamlText: string): string[] {
  try {
    const model = parseYaml(yamlText) as CortexYaml;
    if (!Array.isArray(model?.tables)) return [];
    return model.tables
      .map((t) => t.base_table?.table?.toUpperCase())
      .filter((t): t is string => !!t);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// In-memory cache for parsed table lists (10-minute TTL)
// ---------------------------------------------------------------------------

interface TableCache { tables: string[]; expiresAt: number }
const TABLE_CACHE = new Map<string, TableCache>();
const CACHE_TTL_MS = 10 * 60 * 1_000;

/**
 * Read the semantic model YAML from its Snowflake stage and return the list
 * of table names it references.  Results are cached per FQN.
 * Returns [] when the YAML can't be read (caller falls back to all tables).
 */
async function getAllowedTableNames(stageRef: StageRef, cacheKey: string): Promise<string[]> {
  const cached = TABLE_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.tables;

  // Read the YAML file line-by-line from the stage and concatenate into a
  // single string.  Using SOH (\x01) as the field delimiter means YAML lines
  // containing commas are treated as a single field.
  const sql = `
    SELECT LISTAGG($1, '\n') WITHIN GROUP (ORDER BY METADATA$FILE_ROW_NUMBER) AS YAML_CONTENT
    FROM @${stageRef.db}.${stageRef.schema}.${stageRef.stage}/${stageRef.file}
      (FILE_FORMAT => (TYPE = 'CSV', FIELD_DELIMITER = '\x01', RECORD_DELIMITER = '\n',
                       TRIM_SPACE = FALSE, SKIP_HEADER = 0))
  `;

  const result = await executeSQL(sql);
  const yamlText = String(
    result.rows[0]?.['YAML_CONTENT'] ??
    result.rows[0]?.['yaml_content'] ??
    '',
  );

  const tables = extractTableNamesFromYaml(yamlText);
  TABLE_CACHE.set(cacheKey, { tables, expiresAt: Date.now() + CACHE_TTL_MS });
  return tables;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

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

    const stageRef = parseStageRef(view.fullyQualifiedName);
    if (!stageRef) {
      return Response.json({ columns: [], tableColumns: [] });
    }

    // ── 1. Discover which tables the semantic model YAML actually references ──
    let allowedTables: string[] = [];
    try {
      allowedTables = await getAllowedTableNames(stageRef, view.fullyQualifiedName);
    } catch (err) {
      // If we can't read the YAML (permissions, network, etc.) fall through
      // and show all tables in the schema as before.
      console.warn('[columns] Could not read semantic model YAML — showing all schema tables:', err);
    }

    // ── 2. Query INFORMATION_SCHEMA.COLUMNS filtered to allowed tables ────────
    const tableFilter =
      allowedTables.length > 0
        ? `AND TABLE_NAME IN (${allowedTables.map((t) => `'${t}'`).join(', ')})`
        : '';

    const sql = `
      SELECT TABLE_NAME, COLUMN_NAME
      FROM ${stageRef.db}.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${stageRef.schema}'
        ${tableFilter}
      ORDER BY TABLE_NAME ASC, COLUMN_NAME ASC
    `;

    const result = await executeSQL(sql);

    // Group columns by table
    const tableMap = new Map<string, string[]>();
    for (const r of result.rows) {
      const table = String(r['TABLE_NAME'] ?? r['table_name'] ?? 'UNKNOWN');
      const col   = String(r['COLUMN_NAME'] ?? r['column_name'] ?? '');
      if (!col) continue;
      if (!tableMap.has(table)) tableMap.set(table, []);
      tableMap.get(table)!.push(col);
    }

    // Preserve the order from allowedTables when possible (same order as YAML)
    const orderedTables =
      allowedTables.length > 0
        ? [
            ...allowedTables.filter((t) => tableMap.has(t)),
            ...Array.from(tableMap.keys()).filter((t) => !allowedTables.includes(t)),
          ]
        : Array.from(tableMap.keys());

    const tableColumns = orderedTables
      .filter((t) => tableMap.has(t))
      .map((table) => ({ table, columns: tableMap.get(table)! }));

    const columns = tableColumns.flatMap((t) => t.columns);

    return Response.json({ columns, tableColumns });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message, columns: [], tableColumns: [] }, { status: 500 });
  }
}
