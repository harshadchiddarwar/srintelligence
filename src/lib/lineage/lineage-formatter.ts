/**
 * lineage-formatter — converts a LineageRecord chain into a display-ready
 * graph structure (nodes + edges) for the UI.
 */

import type { LineageRecord } from '../../types/user';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LineageDisplayNode {
  lineageId: string;
  label: string;
  agentName: string;
  timestamp: string;
  tables: string[];
  filters: string[];
  rowCount: number | null;
  cacheStatus: string;
  executionTimeMs: number;
}

export interface LineageDisplay {
  nodes: LineageDisplayNode[];
  edges: Array<{ from: string; to: string }>;
}

// ---------------------------------------------------------------------------
// formatLineageChain
// ---------------------------------------------------------------------------

/**
 * Maps an ordered array of LineageRecord objects (oldest → newest) into a
 * display-ready graph.  Edges are inferred from parentLineageId relationships
 * stored in each record's node metadata.
 */
export function formatLineageChain(chain: LineageRecord[]): LineageDisplay {
  const nodes: LineageDisplayNode[] = chain.map((record) => {
    // Primary node metadata is in nodes[0] for our single-node records
    const primaryNode = record.nodes[0];
    const meta = (primaryNode?.metadata ?? {}) as Record<string, unknown>;

    const tables = Array.isArray(meta['tables']) ? (meta['tables'] as string[]) : [];
    const filters = Array.isArray(meta['filters']) ? (meta['filters'] as string[]) : [];
    const rowCount =
      meta['rowCount'] !== undefined && meta['rowCount'] !== null
        ? Number(meta['rowCount'])
        : null;
    const cacheStatus = String(meta['cacheStatus'] ?? 'unknown');
    const executionTimeMs = Number(meta['executionTimeMs'] ?? 0);

    const timestamp = primaryNode
      ? new Date(primaryNode.startedAt).toISOString()
      : new Date(record.createdAt).toISOString();

    return {
      lineageId: record.lineageId,
      label: primaryNode?.label ?? record.intent,
      agentName: primaryNode?.label ?? record.intent,
      timestamp,
      tables,
      filters,
      rowCount,
      cacheStatus,
      executionTimeMs,
    };
  });

  // Build edges — consecutive records in the chain are connected
  const edges: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const current = chain[i];
    const next = chain[i + 1];
    if (current && next) {
      edges.push({ from: current.lineageId, to: next.lineageId });
    }
  }

  // Also wire explicit parentLineageId edges from metadata
  for (const record of chain) {
    const primaryNode = record.nodes[0];
    const parentId = primaryNode?.metadata?.['parentLineageId'] as string | undefined;
    if (parentId && parentId !== record.lineageId) {
      const edgeExists = edges.some(
        (e) => e.from === parentId && e.to === record.lineageId,
      );
      if (!edgeExists) {
        edges.push({ from: parentId, to: record.lineageId });
      }
    }
  }

  return { nodes, edges };
}
