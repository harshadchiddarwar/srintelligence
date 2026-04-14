/**
 * Dynamic semantic view discovery from SEMANTIC_VIEW_REGISTRY.
 *
 * Caches results per user role with a 5-minute TTL.
 */

import type { SemanticViewRef } from '../../types/agent';
import { executeSQL } from './sql-api';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  views: SemanticViewRef[];
  expiresAt: number;
}

const VIEW_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Snowflake ARRAY_TO_STRING or JSON array string into a string array.
 * The registry stores allowed_roles as a comma-separated string or JSON array.
 */
function parseRoles(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  // Try JSON array first
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim());
      }
    } catch {
      // fall through to CSV parsing
    }
  }
  // CSV fallback
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function rowToSemanticViewRef(row: Record<string, unknown>): SemanticViewRef {
  // The registry stores the semantic model path split across four columns.
  // Cortex Analyst expects: @DATABASE.SCHEMA.STAGE_NAME/yaml_filename
  const db    = String(row['DATABASE_NAME'] ?? '').trim();
  const schema = String(row['SCHEMA_NAME']  ?? '').trim();
  const stage  = String(row['STAGE_NAME']   ?? '').trim();
  const yaml   = String(row['YAML_FILENAME'] ?? '').trim();

  // Detect unfilled template placeholders (e.g. "<YOUR_STAGE_NAME>")
  const isPlaceholder = (s: string) => s.includes('<') || s.includes('>') || s === '';
  const fullyQualifiedName =
    (db && schema && stage && yaml &&
     !isPlaceholder(db) && !isPlaceholder(schema) && !isPlaceholder(stage) && !isPlaceholder(yaml))
      ? `@${db}.${schema}.${stage}/${yaml}`
      : String(row['FULLY_QUALIFIED_NAME'] ?? row['fully_qualified_name'] ?? '');

  return {
    id: String(row['VIEW_ID'] ?? row['view_id'] ?? ''),
    displayName: String(row['DISPLAY_NAME'] ?? row['display_name'] ?? ''),
    description: String(row['DESCRIPTION'] ?? row['description'] ?? ''),
    fullyQualifiedName,
    allowedRoles: parseRoles(row['ALLOWED_ROLES'] ?? row['allowed_roles']),
    isDefault:
      (row['IS_DEFAULT'] ?? row['is_default']) === true ||
      String(row['IS_DEFAULT'] ?? row['is_default']).toLowerCase() === 'true',
    tags: parseRoles(row['TAGS'] ?? row['tags']),
  };
}

/** Hard-coded fallback when the registry table has not yet been created. */
const FALLBACK_VIEW: SemanticViewRef = {
  id: 'cortex_testcase',
  displayName: 'Analytics',
  description: 'Rx claims, drug reference, physicians & plan data',
  fullyQualifiedName: 'CORTEX_TESTING.PUBLIC.CORTEX_TESTCASE',
  allowedRoles: [],
  isDefault: true,
  tags: [],
};

async function loadViewsFromSnowflake(userRole: string): Promise<SemanticViewRef[]> {
  const sql = `
    SELECT *
    FROM CORTEX_TESTING.PUBLIC.SEMANTIC_VIEW_REGISTRY
    WHERE is_active = TRUE
    ORDER BY display_name ASC
  `;

  try {
    // Do not pass userRole — the PAT already authenticates as the correct role.
    // Passing a role would create a 2-statement request that conflicts with
    // Snowflake's default statement count of 1.
    const result = await executeSQL(sql);

    if (result.rows.length === 0) return [FALLBACK_VIEW];

    // Filter on the application side to check role membership
    const upperRole = userRole.toUpperCase();
    const filtered = result.rows
      .map(rowToSemanticViewRef)
      .filter((v) => v.fullyQualifiedName !== '') // drop rows with unfilled placeholders
      .filter(
        (v) =>
          v.allowedRoles.length === 0 ||
          v.allowedRoles.some((r) => r.toUpperCase() === upperRole),
      );

    return filtered.length > 0 ? filtered : [FALLBACK_VIEW];
  } catch (err) {
    // SEMANTIC_VIEW_REGISTRY table not yet created, or role lacks SELECT —
    // use the hardcoded fallback.  Log at debug level only to avoid noisy
    // 422 warnings on every startup.
    const msg = err instanceof Error ? err.message : String(err);
    console.debug('[semantic-discovery] Registry unavailable, using fallback:', msg.slice(0, 120));
    return [FALLBACK_VIEW];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return all active semantic views accessible to `userRole`.
 * Results are cached per role for 5 minutes.
 */
export async function discoverSemanticViews(userRole: string): Promise<SemanticViewRef[]> {
  const cacheKey = userRole.toUpperCase();
  const cached = VIEW_CACHE.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.views;
  }

  const views = await loadViewsFromSnowflake(userRole);
  VIEW_CACHE.set(cacheKey, { views, expiresAt: Date.now() + CACHE_TTL_MS });
  return views;
}

/**
 * Return the default semantic view for `userRole`, or null if none is marked default.
 */
export async function getDefaultSemanticView(
  userRole: string,
): Promise<SemanticViewRef | null> {
  const views = await discoverSemanticViews(userRole);
  return views.find((v) => v.isDefault) ?? null;
}

/**
 * Return a specific semantic view by its `id`, regardless of role filtering.
 * Returns null if the view is not found in the registry.
 */
export async function getSemanticViewById(
  viewId: string,
): Promise<SemanticViewRef | null> {
  // Check all cached entries first
  for (const entry of VIEW_CACHE.values()) {
    const found = entry.views.find((v) => v.id === viewId);
    if (found) return found;
  }

  // Fall back to a direct SQL lookup
  const escapedId = viewId.replace(/'/g, "''");
  const sql = `
    SELECT *
    FROM CORTEX_TESTING.PUBLIC.SEMANTIC_VIEW_REGISTRY
    WHERE view_id = '${escapedId}'
      AND is_active = TRUE
    LIMIT 1
  `;

  const result = await executeSQL(sql);
  if (result.rows.length === 0) return null;
  return rowToSemanticViewRef(result.rows[0]);
}
