/**
 * UserPreferencesManager — fetches and updates per-user preferences with a
 * short in-memory cache to avoid hammering Snowflake on every request.
 */

import type { UserPreferences } from '../../types/user';
import { executeSQL } from '../snowflake/sql-api';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface CacheEntry {
  prefs: UserPreferences;
  cachedAt: number;
}

// ---------------------------------------------------------------------------
// Default preferences
// ---------------------------------------------------------------------------

function buildDefaults(userId: string): UserPreferences {
  return {
    userId,
    theme: 'system',
    preferredChartLibrary: 'recharts',
    narrativeLength: 'standard',
    pinnedIntents: ['ANALYST', 'FORECAST_PROPHET'],
    showCostEstimates: true,
    showSqlByDefault: false,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// UserPreferencesManager (singleton)
// ---------------------------------------------------------------------------

export class UserPreferencesManager {
  private static instance: UserPreferencesManager;
  private cache: Map<string, CacheEntry> = new Map();

  private constructor() {}

  static getInstance(): UserPreferencesManager {
    if (!UserPreferencesManager.instance) {
      UserPreferencesManager.instance = new UserPreferencesManager();
    }
    return UserPreferencesManager.instance;
  }

  // ---------------------------------------------------------------------------
  // Get
  // ---------------------------------------------------------------------------

  async getPreferences(userId: string): Promise<UserPreferences> {
    // Check cache first
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.prefs;
    }

    try {
      const result = await executeSQL(
        `SELECT preferences_json FROM CORTEX_TESTING.PUBLIC.USER_PREFERENCES WHERE user_id = '${userId}' LIMIT 1`,
      );

      if (result.rowCount > 0 && result.rows[0]) {
        const row = result.rows[0] as Record<string, unknown>;
        const prefs = JSON.parse(row['PREFERENCES_JSON'] as string) as UserPreferences;
        this.cache.set(userId, { prefs, cachedAt: Date.now() });
        return prefs;
      }
    } catch {
      // Fall through to defaults
    }

    // No record found — insert defaults and return them
    const defaults = buildDefaults(userId);
    try {
      const json = JSON.stringify(defaults).replace(/'/g, "\\'");
      await executeSQL(
        `INSERT INTO CORTEX_TESTING.PUBLIC.USER_PREFERENCES (user_id, preferences_json, created_at, updated_at)
         VALUES ('${userId}', '${json}', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      );
    } catch {
      // Non-blocking
    }

    this.cache.set(userId, { prefs: defaults, cachedAt: Date.now() });
    return defaults;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  async updatePreferences(
    userId: string,
    updates: Partial<UserPreferences>,
  ): Promise<UserPreferences> {
    const current = await this.getPreferences(userId);
    const merged: UserPreferences = { ...current, ...updates, userId, updatedAt: Date.now() };

    const json = JSON.stringify(merged).replace(/'/g, "\\'");
    try {
      await executeSQL(
        `MERGE INTO CORTEX_TESTING.PUBLIC.USER_PREFERENCES AS tgt
         USING (SELECT '${userId}' AS user_id) AS src ON tgt.user_id = src.user_id
         WHEN MATCHED THEN UPDATE SET
           preferences_json = '${json}',
           updated_at = CURRENT_TIMESTAMP()
         WHEN NOT MATCHED THEN INSERT (user_id, preferences_json, created_at, updated_at)
           VALUES ('${userId}', '${json}', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      );
    } catch (err) {
      console.error('[UserPreferencesManager] Failed to persist preferences:', err);
    }

    // Invalidate cache
    this.cache.delete(userId);
    this.cache.set(userId, { prefs: merged, cachedAt: Date.now() });

    return merged;
  }

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------

  getDefaults(): UserPreferences {
    return buildDefaults('__default__');
  }
}

export const userPreferencesManager = UserPreferencesManager.getInstance();
