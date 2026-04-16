/**
 * Snowflake authentication manager.
 *
 * Supports two auth modes (checked in priority order):
 *   1. PAT  — SNOWFLAKE_PAT env var is set  → Bearer PAT
 *   2. JWT  — SNOWFLAKE_PRIVATE_KEY env var is set → RS256 key-pair JWT
 *
 * Export: class SnowflakeAuthManager (singleton via getInstance())
 * Export: function getAuthManager() — lazy singleton getter
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = `https://${process.env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com`;
const USER_AGENT = 'SRIntelligence/2.0';
const ROLE_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes
const DEFAULT_ROLE = 'APP_SVC_ROLE';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RoleCacheEntry {
  role: string;
  expiresAt: number;
}

type AuthMode = 'PAT' | 'KEYPAIR_JWT';

// ---------------------------------------------------------------------------
// JWT helpers (no external dependency — uses Node crypto)
// ---------------------------------------------------------------------------

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildJwt(privateKeyPem: string, account: string, username: string): string {
  const qualifiedName = `${account.toUpperCase()}.${username.toUpperCase()}`;

  // Compute SHA-256 fingerprint of the public key in DER format
  const keyObj = crypto.createPrivateKey(privateKeyPem);
  const publicKeyObj = crypto.createPublicKey(keyObj);
  const publicDer = publicKeyObj.export({ type: 'spki', format: 'der' });
  const fingerprint =
    'SHA256:' + crypto.createHash('sha256').update(publicDer).digest('base64');

  const nowSec = Math.floor(Date.now() / 1_000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: `${qualifiedName}.${fingerprint}`,
    sub: qualifiedName,
    iat: nowSec,
    exp: nowSec + 3600, // 1 hour validity
  };

  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  sign.end();
  const signature = base64UrlEncode(sign.sign(privateKeyPem));

  return `${signingInput}.${signature}`;
}

// ---------------------------------------------------------------------------
// SnowflakeAuthManager
// ---------------------------------------------------------------------------

export class SnowflakeAuthManager {
  private static instance: SnowflakeAuthManager;
  private readonly roleCache = new Map<string, RoleCacheEntry>();
  private readonly mode: AuthMode;

  private constructor() {
    if (process.env.SNOWFLAKE_PAT) {
      this.mode = 'PAT';
    } else if (process.env.SNOWFLAKE_PRIVATE_KEY) {
      this.mode = 'KEYPAIR_JWT';
    } else {
      throw new Error(
        'Snowflake auth misconfigured: set SNOWFLAKE_PAT or SNOWFLAKE_PRIVATE_KEY',
      );
    }
  }

  static getInstance(): SnowflakeAuthManager {
    if (!SnowflakeAuthManager.instance) {
      SnowflakeAuthManager.instance = new SnowflakeAuthManager();
    }
    return SnowflakeAuthManager.instance;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = this.resolveToken();
    const tokenType: string =
      this.mode === 'PAT' ? 'PROGRAMMATIC_ACCESS_TOKEN' : 'KEYPAIR_JWT';

    return {
      Authorization: `Bearer ${token}`,
      'X-Snowflake-Authorization-Token-Type': tokenType,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    };
  }

  async getUserRole(userId: string): Promise<string> {
    const cached = this.roleCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.role;
    }

    try {
      const role = await this.fetchUserRole(userId);
      this.roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
      return role;
    } catch {
      // Return default role on any error to avoid blocking the request
      return DEFAULT_ROLE;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private resolveToken(): string {
    if (this.mode === 'PAT') {
      const pat = process.env.SNOWFLAKE_PAT;
      if (!pat) throw new Error('SNOWFLAKE_PAT is not set');
      return pat;
    }

    // JWT key-pair
    const privateKeyPem = process.env.SNOWFLAKE_PRIVATE_KEY;
    if (!privateKeyPem) throw new Error('SNOWFLAKE_PRIVATE_KEY is not set');

    const account = process.env.SNOWFLAKE_ACCOUNT;
    if (!account) throw new Error('SNOWFLAKE_ACCOUNT is not set');

    const username = process.env.SNOWFLAKE_USERNAME;
    if (!username) throw new Error('SNOWFLAKE_USERNAME is not set');

    return buildJwt(privateKeyPem, account, username);
  }

  private async fetchUserRole(userId: string): Promise<string> {
    const sql =
      `SELECT role FROM CORTEX_TESTING.PUBLIC.USER_ROLE_MAPPING ` +
      `WHERE user_id = '${userId.replace(/'/g, "''")}' LIMIT 1`;

    const headers = await this.getAuthHeaders();
    const warehouse = process.env.SNOWFLAKE_WAREHOUSE;

    const response = await fetch(`${BASE_URL}/api/v2/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        statement: sql,
        timeout: 30,
        warehouse,
        database: 'CORTEX_TESTING',
        schema: 'PUBLIC',
      }),
    });

    if (!response.ok) {
      throw new Error(`Role lookup failed: HTTP ${response.status}`);
    }

    type RoleRow = [string];
    const json = (await response.json()) as {
      data?: RoleRow[];
    };
    const rows = json.data ?? [];
    if (rows.length > 0 && rows[0][0]) {
      return rows[0][0];
    }
    return DEFAULT_ROLE;
  }
}

// Lazy getter — do NOT instantiate at module load time so that the build
// succeeds even when env vars are absent (e.g. during Vercel's build phase).
export function getAuthManager(): SnowflakeAuthManager {
  return SnowflakeAuthManager.getInstance();
}
