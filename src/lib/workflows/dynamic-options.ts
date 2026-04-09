/**
 * dynamic-options — resolves optionsQuery for WorkflowParameter select types.
 * Results are cached per (normalizedQuery, userRole) for 5 minutes.
 */

import { executeSQL } from '../snowflake/sql-api';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1_000;

interface CacheEntry {
  options: Array<{ value: string; label: string }>;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

function makeCacheKey(query: string, userRole: string): string {
  // Normalise whitespace to reduce duplicate entries
  return `${userRole}::${query.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

// ---------------------------------------------------------------------------
// loadDynamicOptions
// ---------------------------------------------------------------------------

/**
 * Executes the provided SQL query (as `userRole`) and maps the first two
 * columns to { value, label } pairs.  Results are cached per (query, role)
 * for up to 5 minutes.
 */
export async function loadDynamicOptions(
  query: string,
  userRole: string,
): Promise<Array<{ value: string; label: string }>> {
  const key = makeCacheKey(query, userRole);

  // Check cache
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.options;
  }

  const result = await executeSQL(query, userRole);

  const options: Array<{ value: string; label: string }> = result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const cols = result.columns;

    const value = cols[0] ? String(r[cols[0]] ?? '') : '';
    const label = cols[1] ? String(r[cols[1]] ?? value) : value;

    return { value, label };
  });

  cache.set(key, { options, cachedAt: Date.now() });

  return options;
}
