"use client";

import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import type { ScatterShapeProps } from "recharts";
import {
  Maximize2,
  X,
  Download,
  Users,
  BarChart2,
  Activity,
  AlertCircle,
  Table2,
} from "lucide-react";
import type { AgentArtifact } from "@/src/types/agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SegmentProfile {
  id: number;
  name: string;
  size: number;
  pct: number;
  description?: string;
  topDriver?: string;
  characteristics: string[];
  avgValues: Record<string, number>;
  zScores?: Record<string, number>;
  // Domain-specific
  uniquePatients?: number;
  livesCovered?: number;
  topRegimen?: string;
  comorbidities?: string[];
  demographics?: Record<string, string>;
}

export interface PcaPoint {
  pc1: number;
  pc2: number;
  cluster: number;
  pct?: number;  // segment membership % (for centroid mode tooltip)
}

export interface MemberRecord {
  id: string | number;
  name?: string;
  cluster: number;
  clusterName?: string;
  [key: string]: unknown;
}

export interface SegmentationData {
  algorithm?: string;
  totalRecords?: number;
  featuresUsed?: string[];
  clusterCount?: number;
  clusterCountMethod?: "auto" | "user";
  silhouetteScore?: number;
  confidenceLevel?: number;
  interpretation?: string;
  segments: SegmentProfile[];
  pcaPoints?: PcaPoint[];
  pc1Label?: string;
  pc2Label?: string;
  pc1Variance?: number;
  pc2Variance?: number;
  /** Top-loading feature names for each PC (derived from eigenvector magnitudes) */
  pc1TopFeatures?: string[];
  pc2TopFeatures?: string[];
  membershipTable?: MemberRecord[];
  caveats?: string[];
}

// ---------------------------------------------------------------------------
// Color palette — 8 unique palettes (bg, border, accent, text)
// ---------------------------------------------------------------------------

const PALETTES = [
  { bg: "#eff6ff", border: "#bfdbfe", accent: "#3b82f6", text: "#1d4ed8" },   // blue
  { bg: "#f5f3ff", border: "#ddd6fe", accent: "#7c3aed", text: "#5b21b6" },   // violet
  { bg: "#f0fdf4", border: "#bbf7d0", accent: "#16a34a", text: "#15803d" },   // green
  { bg: "#fff7ed", border: "#fed7aa", accent: "#ea580c", text: "#c2410c" },   // orange
  { bg: "#fdf2f8", border: "#f5d0fe", accent: "#a21caf", text: "#86198f" },   // pink
  { bg: "#ecfeff", border: "#a5f3fc", accent: "#0891b2", text: "#0e7490" },   // cyan
  { bg: "#fefce8", border: "#fde68a", accent: "#ca8a04", text: "#a16207" },   // yellow
  { bg: "#fff1f2", border: "#fecdd3", accent: "#e11d48", text: "#be123c" },   // rose
];

const STROKE_COLORS = PALETTES.map((p) => p.accent);

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span style={{ color: "var(--accent)" }}>{icon}</span>
      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</span>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center px-4 py-2.5 rounded-xl" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      <span className="text-xs mb-0.5" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

interface DownloadButtonProps {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}
function DownloadButton({ label, icon, onClick }: DownloadButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
    >
      {icon ?? <Download size={12} />}
      {label}
    </button>
  );
}

function FullscreenOverlay({
  title,
  onClose,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "var(--bg-primary, #fff)" }}
    >
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)" }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</span>
        <div className="flex items-center gap-2">
          {actions}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/8 transition-colors"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6">{children}</div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// CSV / PPTX download helpers
// ---------------------------------------------------------------------------

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

async function exportSegmentsToPptx(segments: SegmentProfile[]) {
  try {
    const pptxgen = (await import("pptxgenjs")).default;
    const prs = new pptxgen();
    prs.layout = "LAYOUT_WIDE";

    for (const seg of segments) {
      const slide = prs.addSlide();
      const pal = PALETTES[seg.id % PALETTES.length];
      slide.addText(`Segment: ${seg.name}`, { x: 0.5, y: 0.3, w: 11, fontSize: 22, bold: true, color: pal.accent.replace("#", "") });
      slide.addText(`${seg.pct.toFixed(1)}% of total (n=${seg.size.toLocaleString()})`, { x: 0.5, y: 0.9, w: 11, fontSize: 14, color: "666666" });
      if (seg.description) {
        slide.addText("Description", { x: 0.5, y: 1.5, w: 11, fontSize: 13, bold: true, color: "333333" });
        slide.addText(seg.description, { x: 0.5, y: 1.9, w: 11, fontSize: 11, color: "444444" });
      }
      if (seg.topDriver) {
        slide.addText("Top Driver", { x: 0.5, y: 2.8, w: 11, fontSize: 13, bold: true, color: "333333" });
        slide.addText(seg.topDriver, { x: 0.5, y: 3.2, w: 11, fontSize: 11, color: pal.accent.replace("#", "") });
      }
    }

    await prs.writeFile({ fileName: "segmentation_report.pptx" });
  } catch {
    // fallback — download CSV summary
    const headers = ["Segment", "Size", "Pct", "Description", "Top Driver"];
    const rows = segments.map((s) => [s.name, s.size, `${s.pct.toFixed(1)}%`, s.description ?? "", s.topDriver ?? ""]);
    downloadCSV("segmentation_summary.csv", headers, rows);
  }
}

// ---------------------------------------------------------------------------
// Helpers: metric extraction, z-score computation, PCA
// ---------------------------------------------------------------------------

/**
 * Try to populate segment.avgValues from markdown tables or inline "metric: value"
 * patterns found in the narrative text.
 *
 * Supported table orientations:
 *   A) Rows = metrics, Cols = segment names/IDs
 *      | Metric         | Segment 1 | Segment 2 | ...
 *   B) Rows = segments, Cols = metric names
 *      | Segment        | Avg Rx    | Days Sup  | ...
 */
function extractMetricsIntoSegments(text: string, segments: SegmentProfile[]): void {
  if (segments.length === 0) return;

  // ── Orientation A: rows=metrics, cols=segments ──────────────────────────
  const tables = [...text.matchAll(/(\|[^\n]+\|\n\|[\s\-:|]+\|\n(?:\|[^\n]+\|\n?)+)/g)];
  for (const tableMatch of tables) {
    const lines = tableMatch[1].trim().split("\n");
    if (lines.length < 3) continue;

    const parseRow = (line: string) =>
      line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

    const headers = parseRow(lines[0]);
    const dataLines = lines.slice(2);

    // Map column index → segment
    const colToSeg: Map<number, SegmentProfile> = new Map();
    headers.forEach((h, ci) => {
      if (ci === 0) return;
      const hNorm = h.toLowerCase().replace(/\s+/g, " ");
      for (const seg of segments) {
        if (
          hNorm === `segment ${seg.id}` ||
          hNorm === `cluster ${seg.id}` ||
          hNorm.includes(seg.name.toLowerCase().slice(0, 8))
        ) {
          colToSeg.set(ci, seg);
        }
      }
    });

    if (colToSeg.size === 0) {
      // ── Orientation B: rows=segments, cols=metrics ─────────────────────
      // First col identifies the segment; remaining cols are numeric metrics
      for (const line of dataLines) {
        const cells = parseRow(line);
        if (cells.length < 2) continue;
        const rowLabel = cells[0].toLowerCase();
        const seg = segments.find(
          (s) =>
            rowLabel === `segment ${s.id}` ||
            rowLabel === `cluster ${s.id}` ||
            rowLabel.includes(s.name.toLowerCase().slice(0, 8))
        );
        if (!seg) continue;
        headers.slice(1).forEach((metricName, j) => {
          const val = parseFloat(cells[j + 1]?.replace(/[^0-9.\-]/g, "") ?? "");
          if (!isNaN(val) && metricName) seg.avgValues[metricName] = val;
        });
      }
      continue;
    }

    // Orientation A — parse each data row as "MetricName | v1 | v2 | ..."
    for (const line of dataLines) {
      const cells = parseRow(line);
      const metricName = cells[0];
      if (!metricName) continue;
      colToSeg.forEach((seg, ci) => {
        const val = parseFloat(cells[ci]?.replace(/[^0-9.\-]/g, "") ?? "");
        if (!isNaN(val)) seg.avgValues[metricName] = val;
      });
    }
  }

  // ── Per-cluster block extraction ─────────────────────────────────────────
  //    Orientation C: local per-cluster tables with Feature/Mean/Z-Score columns
  //    e.g.  | Feature | Mean | Z-Score |
  //          | DAYS_SUPPLY | 30.2 | -0.82 |
  //    These tables appear WITHIN each cluster's text block.
  //
  //    Also handles bullet/inline "Feature: 30.2 (Z=-0.82)" patterns.
  const segPositions2: { id: number; start: number }[] = [];
  const sp2 = /(?:\*{0,2})(?:Segment|Cluster)\s+(\d+)/gi;
  let sm2: RegExpExecArray | null;
  while ((sm2 = sp2.exec(text)) !== null) {
    const id = parseInt(sm2[1]);
    if (segments.some((s) => s.id === id)) segPositions2.push({ id, start: sm2.index });
  }

  const parseRow2 = (line: string) =>
    line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  for (let i = 0; i < segPositions2.length; i++) {
    const { id, start } = segPositions2[i];
    const end = segPositions2[i + 1]?.start ?? text.length;
    const block = text.slice(start, end);
    const seg = segments.find((s) => s.id === id);
    if (!seg) continue;

    // ── C: find all markdown tables in this block ──────────────────────────
    const blockTables = [...block.matchAll(/(\|[^\n]+\|\n\|[\s\-:|]+\|\n(?:\|[^\n]+\|\n?)+)/g)];
    for (const tMatch of blockTables) {
      const lines = tMatch[1].trim().split("\n");
      if (lines.length < 3) continue;
      const headers = parseRow2(lines[0]);
      const dataLines = lines.slice(2); // skip separator

      // Find Z-Score and Mean column indices
      const zIdx = headers.findIndex((h) => /z.?score|z.?val|z$/i.test(h));
      const meanIdx = headers.findIndex((h) => /^mean$|^avg$|^average$|^value$/i.test(h));

      if (zIdx >= 0) {
        // Feature name is always col 0
        for (const line of dataLines) {
          const cells = parseRow2(line);
          const featureName = cells[0]?.replace(/\*+/g, "").trim();
          if (!featureName || featureName.startsWith("_")) continue;
          const zVal = parseFloat(cells[zIdx]?.replace(/[^0-9.\-+]/g, "") ?? "");
          if (!isNaN(zVal) && Math.abs(zVal) <= 10) {
            if (!seg.zScores) seg.zScores = {};
            seg.zScores[featureName] = zVal;
          }
          if (meanIdx >= 0) {
            const meanVal = parseFloat(cells[meanIdx]?.replace(/[^0-9.\-]/g, "") ?? "");
            if (!isNaN(meanVal)) seg.avgValues[featureName] = meanVal;
          }
        }
      } else if (meanIdx >= 0) {
        // No Z-Score column — just extract mean values
        for (const line of dataLines) {
          const cells = parseRow2(line);
          const featureName = cells[0]?.replace(/\*+/g, "").trim();
          if (!featureName || featureName.startsWith("_")) continue;
          const meanVal = parseFloat(cells[meanIdx]?.replace(/[^0-9.\-]/g, "") ?? "");
          if (!isNaN(meanVal)) seg.avgValues[featureName] = meanVal;
        }
      }
    }

    // ── Inline labelled patterns: "Feature: 30.2 (Z = -0.82)" or "**Feature**: 30.2" ──
    const inlinePattern = /\b([A-Za-z][A-Za-z0-9 _]{2,28})\s*[:=]\s*(\d+(?:\.\d+)?)\b/g;
    let im: RegExpExecArray | null;
    while ((im = inlinePattern.exec(block)) !== null) {
      const label = im[1].trim();
      const val = parseFloat(im[2]);
      if (/^(segment|cluster|group|section|pct|percent|count|size|id|name|note|source|type|figure|table|step|part|page|item|rank|order|tier|band|level|layer|class|phase|stage|round|wave|batch|iteration|epoch|fold|run|trial|pass)/i.test(label)) continue;
      if (!isNaN(val) && val >= 0 && val < 1e9 && !(label in seg.avgValues)) {
        seg.avgValues[label] = val;
      }
    }
  }
}

/**
 * Scan each segment's description / topDriver text for patterns like:
 *   "days supply (Z=-0.80)"   "claim counts Z=+3.41"   "patients (Z≈2.15)"
 * and directly populate segment.zScores[featureName] = parsedValue.
 *
 * This handles the SRI clustering agent narrative which embeds z-scores inline.
 */
function extractInlineZScores(text: string, segments: SegmentProfile[]): void {
  if (segments.length === 0) return;

  // Locate each segment's text block in the narrative
  const segPositions: { id: number; start: number }[] = [];
  const sp = /(?:\*{0,2})(?:Segment|Cluster)\s+(\d+)/gi;
  let sm: RegExpExecArray | null;
  while ((sm = sp.exec(text)) !== null) {
    const id = parseInt(sm[1]);
    if (segments.some((s) => s.id === id)) segPositions.push({ id, start: sm.index });
  }

  // Pattern: up to 5 words before "(Z=±VALUE)" or "Z=±VALUE" or "z_score: VALUE"
  // e.g. "days supply (Z=-0.80)" / "unique patient counts (Z=+2.15)" / "claim counts Z=3.41"
  // Also handles "**Feature**: value (Z = -0.82)" and "Z-score: -0.82" prefixed by feature context
  const zPattern = /\b([A-Za-z][A-Za-z0-9 _]{2,40}?)\s*\(?Z[\s_-]*[=:≈~]\s*([+-]?\d+(?:\.\d+)?)\)?/gi;

  for (let i = 0; i < segPositions.length; i++) {
    const { id, start } = segPositions[i];
    const end = segPositions[i + 1]?.start ?? text.length;
    const block = text.slice(start, end);
    const seg = segments.find((s) => s.id === id);
    if (!seg) continue;

    zPattern.lastIndex = 0;
    let zm: RegExpExecArray | null;
    while ((zm = zPattern.exec(block)) !== null) {
      const rawFeature = zm[1].trim().replace(/\s+/g, " ");
      const zVal = parseFloat(zm[2]);
      if (isNaN(zVal) || Math.abs(zVal) > 10) continue; // sanity check

      // Normalise feature name: strip leading "average" / "mean" / "avg" / "total"
      const feature = rawFeature
        .replace(/^(?:average|mean|avg|total|overall|relative|below.average|above.average)\s+/i, "")
        .trim();
      if (feature.length < 3) continue;
      // Skip if it looks like a percent/count noise token
      if (/^(segment|cluster|group|pct|percent|count|size|id|name|type|rank)/i.test(feature)) continue;

      if (!seg.zScores) seg.zScores = {};
      seg.zScores[feature] = zVal;
    }
  }

  // Also scan the topDriver / description fields directly stored on each segment
  for (const seg of segments) {
    const texts = [seg.description ?? "", seg.topDriver ?? "", ...(seg.characteristics ?? [])].join(" ");
    zPattern.lastIndex = 0;
    let zm: RegExpExecArray | null;
    while ((zm = zPattern.exec(texts)) !== null) {
      const rawFeature = zm[1].trim().replace(/\s+/g, " ");
      const zVal = parseFloat(zm[2]);
      if (isNaN(zVal) || Math.abs(zVal) > 10) continue;
      const feature = rawFeature
        .replace(/^(?:average|mean|avg|total|overall|relative|below.average|above.average)\s+/i, "")
        .trim();
      if (feature.length < 3) continue;
      if (/^(segment|cluster|group|pct|percent|count|size|id|name|type|rank)/i.test(feature)) continue;
      if (!seg.zScores) seg.zScores = {};
      if (!(feature in seg.zScores)) seg.zScores[feature] = zVal;
    }
  }
}

/** Compute cross-segment z-scores from avgValues and mutate segment.zScores in place. */
function computeZScoresInPlace(segments: SegmentProfile[]): void {
  const allKeys = Array.from(new Set(segments.flatMap((s) => Object.keys(s.avgValues))));
  for (const key of allKeys) {
    const vals = segments.map((s) => s.avgValues[key] ?? 0);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    if (std > 0.0001) {
      segments.forEach((s) => {
        if (!s.zScores) s.zScores = {};
        s.zScores[key] = ((s.avgValues[key] ?? mean) - mean) / std;
      });
    }
  }
}

/**
 * Compute a 2-component PCA on the segment z-score matrix.
 * Returns one centroid PcaPoint per segment (cluster = segment.id).
 * Uses power-iteration to find the top two eigenvectors of the covariance matrix.
 */
interface PcaResult {
  points: PcaPoint[];
  pc1Variance: number;
  pc2Variance: number;
  /** Top N features by absolute loading magnitude on each PC */
  pc1TopFeatures: string[];
  pc2TopFeatures: string[];
}

function computeSegmentPca(segments: SegmentProfile[]): PcaResult | null {
  const features = Array.from(
    new Set(segments.flatMap((s) => Object.keys(s.zScores ?? {})))
  );
  if (features.length < 2 || segments.length < 2) return null;

  // Build matrix: N segments × P features
  const M: number[][] = segments.map((s) =>
    features.map((f) => (s.zScores ?? {})[f] ?? 0)
  );
  const N = M.length;
  const P = features.length;

  // Column-center
  const colMeans = features.map((_, j) => M.reduce((s, row) => s + row[j], 0) / N);
  const C: number[][] = M.map((row) => row.map((v, j) => v - colMeans[j]));

  // Covariance matrix P × P
  const cov: number[][] = Array.from({ length: P }, (_, i) =>
    Array.from({ length: P }, (__, j) => {
      let s = 0;
      for (let k = 0; k < N; k++) s += C[k][i] * C[k][j];
      return s / Math.max(N - 1, 1);
    })
  );

  // Total variance = trace of covariance matrix
  const totalVariance = cov.reduce((s, row, i) => s + row[i], 0) || 1;

  /** Power iteration — returns the dominant unit eigenvector of `mat`. */
  function powerIter(mat: number[][]): number[] {
    let v: number[] = Array.from({ length: P }, (_, i) => (i === 0 ? 1 : 0));
    for (let iter = 0; iter < 80; iter++) {
      const mv = Array.from({ length: P }, (_, i) =>
        mat[i].reduce((s, x, jj) => s + x * v[jj], 0)
      );
      const norm = Math.sqrt(mv.reduce((s, x) => s + x * x, 0)) || 1;
      v = mv.map((x) => x / norm);
    }
    return v;
  }

  const pc1Vec = powerIter(cov);
  const lambda1 = pc1Vec.reduce(
    (s, _, i) => s + pc1Vec[i] * cov[i].reduce((ss, x, j) => ss + x * pc1Vec[j], 0),
    0
  );

  // Deflate for PC2
  const cov2: number[][] = cov.map((row, i) =>
    row.map((val, j) => val - lambda1 * pc1Vec[i] * pc1Vec[j])
  );
  const pc2Vec = powerIter(cov2);
  const lambda2 = pc2Vec.reduce(
    (s, _, i) => s + pc2Vec[i] * cov2[i].reduce((ss, x, j) => ss + x * pc2Vec[j], 0),
    0
  );

  // Variance explained (% of total covariance trace)
  const pc1Variance = Math.min((lambda1 / totalVariance) * 100, 100);
  const pc2Variance = Math.min((Math.max(lambda2, 0) / totalVariance) * 100, 100);

  // Top features by absolute loading — sort indices by |loading| descending
  const topN = Math.min(3, P);
  const pc1TopFeatures = [...features]
    .map((f, i) => ({ f, w: Math.abs(pc1Vec[i]) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, topN)
    .map((x) => x.f);
  const pc2TopFeatures = [...features]
    .map((f, i) => ({ f, w: Math.abs(pc2Vec[i]) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, topN)
    .map((x) => x.f);

  const points: PcaPoint[] = segments.map((seg, k) => ({
    pc1: C[k].reduce((s, v, j) => s + v * pc1Vec[j], 0),
    pc2: C[k].reduce((s, v, j) => s + v * pc2Vec[j], 0),
    cluster: seg.id,
    pct: seg.pct > 0 ? seg.pct : undefined,
  }));

  return { points, pc1Variance, pc2Variance, pc1TopFeatures, pc2TopFeatures };
}

// ---------------------------------------------------------------------------
// parseClusteringNarrative — parse v3 named-agent text into SegmentationData
// ---------------------------------------------------------------------------

export function parseClusteringNarrative(text: string): SegmentationData {
  const result: SegmentationData = { segments: [] };

  // ── Algorithm
  const algoMatch = text.match(/\b(KMEANS|K-MEANS|GMM|DBSCAN|HIERARCHICAL|KMEDOIDS|K-MEDOIDS|PROPHET|SARIMA|AUTO)\b/i)
    ?? text.match(/algorithm[:\s]+([A-Z_\-]+)/i);
  if (algoMatch) result.algorithm = algoMatch[1].toUpperCase().replace(/-/g, "_");

  // ── Total records — physicians, patients, plans, records, members
  const recordsMatch = text.match(/(\d[\d,]+)\s+(?:physicians?|patients?|plans?|payors?|records?|members?|lives?)\s+(?:were\s+)?(?:analyzed|segmented|clustered|included)/i)
    ?? text.match(/analy[sz](?:ed|ing)\s+(\d[\d,]+)/i)
    ?? text.match(/(\d[\d,]+)\s+(?:records?|observations?|data\s+points?)/i);
  if (recordsMatch) result.totalRecords = parseInt(recordsMatch[1].replace(/,/g, ""));

  // ── Features used
  const featuresMatch = text.match(/(\d+)\s+(?:features?|variables?|metrics?|dimensions?)\s+(?:were\s+)?(?:used|included|selected)/i)
    ?? text.match(/using\s+(\d+)\s+(?:features?|variables?|metrics?)/i);
  if (featuresMatch) {
    const n = parseInt(featuresMatch[1]);
    result.featuresUsed = Array.from({ length: n }, (_, i) => `Feature ${i + 1}`);
  }
  // Also try to find named features in a list like "Features: X, Y, Z"
  const featuresListMatch = text.match(/(?:features?|variables?|metrics?)\s+(?:used|included)[:\s]+([A-Z_,\s\(\)]+?)(?=\n|\.)/i);
  if (featuresListMatch && !result.featuresUsed) {
    result.featuresUsed = featuresListMatch[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
  }

  // ── Cluster count
  const clusterCountMatch = text.match(/(\d+)\s+(?:clusters?|segments?)\s+(?:were\s+)?(?:found|identified|discovered|created|formed)/i)
    ?? text.match(/(?:identified|found|created)\s+(\d+)\s+(?:clusters?|segments?)/i);
  if (clusterCountMatch) result.clusterCount = parseInt(clusterCountMatch[1]);

  // ── Silhouette score
  const silMatch = text.match(/silhouette\s+(?:score|coefficient)[^:]*[:\s]+([\d.]+)/i)
    ?? text.match(/silhouette[^:]*:\s*([\d.]+)/i)
    ?? text.match(/\b(0\.\d{2,4})\b.*silhouette/i);
  if (silMatch) result.silhouetteScore = parseFloat(silMatch[1]);

  // ── Interpretation: first meaningful sentence/paragraph before segment list
  const introMatch = text.match(/^([\s\S]{30,400}?)(?=\n\n|\*\*Segment|\*\*Cluster|Segment\s+\d|Cluster\s+\d)/i);
  if (introMatch) {
    const intro = introMatch[1]
      .trim()
      .replace(/^#+\s+[^\n]+\n?/gm, "")   // strip markdown headers
      .replace(/\*\*/g, "")
      .replace(/\n/g, " ")
      .trim();
    if (intro.length > 40) result.interpretation = intro.slice(0, 400);
  }

  // ── Caveats section
  const caveatBlock = text.match(/(?:caveats?|limitation|note)s?[:\n]([\s\S]*?)(?=\n#|\n\*\*|$)/i);
  if (caveatBlock) {
    result.caveats = caveatBlock[1]
      .split(/\n/)
      .map((l) => l.replace(/^[\s\-*•⚠️]+/, "").trim())
      // Filter out metadata footer lines like "Algorithm: KMEANS • duration: ...ms • cache: ..."
      .filter((l) => l.length > 10 && !/algorithm.*duration.*cache/i.test(l) && !/duration:\s*\d+ms/i.test(l));
  }

  // ── Segment blocks — look for numbered/named segment headers
  // Handles both multi-line and single-line formats:
  //   "**Segment 1 — Short-Term Prescribers (34.26%):** Description text..."
  //   "Segment 1\nDescription line 1\nDescription line 2"
  const segmentPattern = /(?:\*{0,2})(?:Segment|Cluster)\s+(\d+)[:\s–—\*]*([^\n]*)/gi;
  let m: RegExpExecArray | null;
  const seenIds = new Set<number>();
  const segments: SegmentProfile[] = [];

  while ((m = segmentPattern.exec(text)) !== null) {
    const id = parseInt(m[1]);
    if (seenIds.has(id)) continue;   // skip duplicate mentions of same segment
    seenIds.add(id);

    // ── Parse name vs description from the captured line
    // The line may be:
    //   "**Short-Term Prescribers (34.26%):** Description..."   ← prose format
    //   "Short-Term Prescribers"                                ← simple
    //   "| Low Brand1 Share | 1,838 | 36.76% | ..."            ← table row (pipe-delimited)
    let rawLine = m[2].trim().replace(/^\*\*+/, "").trim();

    // ── Table-row format: when the matched suffix is pipe-delimited,
    //    extract only the first non-empty cell as the name.
    let descFromLine = "";
    let shortName: string;
    if (rawLine.includes("|")) {
      const cells = rawLine.split("|").map((c) => c.trim()).filter(Boolean);
      // cells[0] = segment name, cells[1..] = numeric data (size, pct, features, z-scores…)
      shortName = cells[0].replace(/\*+/g, "").trim();
      // Any remaining cells that look textual (not purely numeric/percent) become description
      const nonNumericCells = cells.slice(1).filter((c) => /[A-Za-z]/.test(c) && c.length > 1);
      descFromLine = nonNumericCells.join(" · ").trim();
    } else {
      // Split on ":**" (bold colon) or ": " (plain colon)
      const boldColonIdx = rawLine.indexOf(":**");
      const plainColonIdx = rawLine.indexOf(": ");
      const splitIdx = boldColonIdx >= 0 ? boldColonIdx : plainColonIdx >= 0 ? plainColonIdx : -1;
      shortName = splitIdx > 0 ? rawLine.slice(0, splitIdx).replace(/\*+/g, "").trim() : rawLine.replace(/\*+/g, "").trim();
      descFromLine = splitIdx > 0 ? rawLine.slice(splitIdx + (boldColonIdx >= 0 ? 3 : 2)).trim() : "";
    }

    // ── Extract pct from name like "Short-Term Prescribers (34.26%)"
    const pctFromName = shortName.match(/([\d.]+)\s*%/);
    const pct = pctFromName ? parseFloat(pctFromName[1]) : 0;
    shortName = shortName.replace(/\s*\([\d.]+\s*%\)/, "").replace(/^\s*[—–\-]\s*/, "").trim() || `Segment ${id}`;

    // ── Characteristics: use description from the same line + any subsequent indented lines
    const characteristics: string[] = [];
    if (descFromLine.length > 5) characteristics.push(descFromLine);

    // Also extract any Z-score mentions as top driver
    const zMatch = descFromLine.match(/Z\s*[=+]\s*([+-]?[\d.]+)/i) ?? rawLine.match(/Z\s*[=+]\s*([+-]?[\d.]+)/i);
    const topDriver = zMatch ? rawLine.replace(/\*+/g, "").replace(/\s+/g, " ").trim().slice(0, 100) : undefined;

    segments.push({
      id,
      name: shortName,
      size: 0,
      pct,
      description: descFromLine.length > 5 ? descFromLine.slice(0, 300) : undefined,
      topDriver,
      characteristics: characteristics.slice(0, 6),
      avgValues: {},
    });
  }

  // If no segments found via pattern, try bullet list format
  // But only if bullets look like actual segments (have a % or segment-like language, NOT metric descriptions)
  if (segments.length === 0) {
    const bulletSegments = text.match(/(?:^|\n)[•\-*]\s+\*{0,2}([^*\n]{5,60})\*{0,2}[:\s]+([\s\S]*?)(?=\n[•\-*]|\n#|$)/g);
    if (bulletSegments) {
      const METRIC_BULLET_RE = /number of|average|per claim|prescriptions written|payment per|medications prescribed|patients served/i;
      const validBullets = bulletSegments.filter((b) => !METRIC_BULLET_RE.test(b));
      validBullets.forEach((block, idx) => {
        const lines = block.split("\n").filter(Boolean);
        const name = lines[0].replace(/^[•\-*\s*]+/, "").replace(/\*+/g, "").trim();
        segments.push({
          id: idx,
          name: name || `Segment ${idx + 1}`,
          size: 0,
          pct: 0,
          characteristics: lines.slice(1).map((l) => l.replace(/^[\s\-*•]+/, "").trim()).filter(Boolean).slice(0, 5),
          avgValues: {},
        });
      });
    }
  }

  result.segments = segments;
  result.clusterCount = result.clusterCount ?? segments.length;

  // ── Populate avgValues from any tables / inline metrics in narrative
  extractMetricsIntoSegments(text, segments);

  // ── Directly extract inline z-scores like "days supply (Z=-0.80)"
  extractInlineZScores(text, segments);

  // ── Compute z-scores across segments for each avgValues metric
  //    (skips keys already populated by extractInlineZScores)
  computeZScoresInPlace(segments);

  // ── Build PCA centroid points from z-scores (1 point per segment)
  const pcaResult = computeSegmentPca(segments);
  if (pcaResult && pcaResult.points.length > 0) {
    result.pcaPoints    = pcaResult.points;
    result.pc1Variance  = pcaResult.pc1Variance;
    result.pc2Variance  = pcaResult.pc2Variance;
    result.pc1TopFeatures = pcaResult.pc1TopFeatures;
    result.pc2TopFeatures = pcaResult.pc2TopFeatures;
    result.pc1Label = "PC1";
    result.pc2Label = "PC2";
  }

  // ── Update featuresUsed from discovered avgValues keys if not already set
  const discoveredFeatures = Array.from(
    new Set(segments.flatMap((s) => Object.keys(s.avgValues)))
  );
  if (discoveredFeatures.length > 0 && !result.featuresUsed?.length) {
    result.featuresUsed = discoveredFeatures;
  }

  return result;
}

// ---------------------------------------------------------------------------
// fromV2ClusterData — convert v2 structured { segments, algorithm, ... }
// ---------------------------------------------------------------------------

export function fromV2ClusterData(data: Record<string, unknown>): SegmentationData {
  const rawSegments = (data["segments"] as Record<string, unknown>[] | undefined) ?? [];
  const totalRecords = (data["totalRecords"] as number | undefined) ?? rawSegments.reduce((s, seg) => s + ((seg["size"] as number) ?? 0), 0);

  const segments: SegmentProfile[] = rawSegments.map((seg, i) => {
    const size = (seg["size"] as number) ?? 0;
    // Preserve pct from stored data when totalRecords is 0 (narrative-parsed data has size=0)
    const storedPct = (seg["pct"] as number | undefined);
    const pct = totalRecords > 0 ? (size / totalRecords) * 100 : (storedPct ?? 0);
    const avgValues = (seg["avgValues"] as Record<string, number>) ?? {};
    const characteristics = (seg["characteristics"] as string[]) ?? [];

    return {
      id: (seg["id"] as number) ?? i,
      name: (() => {
        const raw = ((seg["label"] as string) ?? (seg["name"] as string) ?? `Segment ${i + 1}`).replace(/^\s*[—–\-]\s*/, "").trim();
        // Strip pipe-delimited table data that may have leaked into the name field
        return raw.includes("|") ? raw.split("|").map((c) => c.trim()).filter(Boolean)[0] ?? `Segment ${i + 1}` : raw;
      })(),
      size,
      pct,
      characteristics,
      avgValues,
      // Preserve any zScores already parsed (e.g. from parseClusteringNarrative + extractInlineZScores)
      zScores: (seg["zScores"] as Record<string, number> | undefined) ?? undefined,
      description: (seg["description"] as string) ?? undefined,
      topDriver: (seg["topDriver"] as string) ?? undefined,
      uniquePatients: (seg["uniquePatients"] as number) ?? undefined,
      livesCovered: (seg["livesCovered"] as number) ?? undefined,
    };
  });

  // Compute z-scores from avgValues (only for keys not already set from preserved zScores)
  const allKeys = Array.from(new Set(segments.flatMap((s) => Object.keys(s.avgValues))));
  for (const key of allKeys) {
    const vals = segments.map((s) => s.avgValues[key] ?? 0);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    if (std > 0) {
      segments.forEach((s) => {
        if (!s.zScores) s.zScores = {};
        if (!(key in s.zScores)) s.zScores[key] = ((s.avgValues[key] ?? mean) - mean) / std;
      });
    }
  }

  // Preserve pcaPoints if already present in the input data
  const pcaPoints = (data["pcaPoints"] as PcaPoint[] | undefined);

  return {
    algorithm: (data["algorithm"] as string) ?? undefined,
    totalRecords,
    clusterCount: (data["clusterCount"] as number) ?? segments.length,
    clusterCountMethod: (data["requestedSegments"] as number) ? "user" : "auto",
    silhouetteScore: (data["silhouetteScore"] as number) ?? undefined,
    interpretation: (data["interpretation"] as string) ?? undefined,
    segments,
    pcaPoints: pcaPoints && pcaPoints.length > 0 ? pcaPoints : undefined,
    pc1Label: (data["pc1Label"] as string) ?? undefined,
    pc2Label: (data["pc2Label"] as string) ?? undefined,
    pc1Variance: (data["pc1Variance"] as number) ?? undefined,
    pc2Variance: (data["pc2Variance"] as number) ?? undefined,
    membershipTable: (data["membershipTable"] as MemberRecord[]) ?? undefined,
    caveats: (data["caveats"] as string[]) ?? undefined,
    featuresUsed: allKeys.length > 0 ? allKeys : (data["featuresUsed"] as string[]) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// fromResultTable — parse the Snowflake clustering result table
//
// Column schema:  RECORD_ID | CLUSTER_ID | CLUSTER_LABEL | CLUSTER_PROBABILITY
//               | CLUSTER_ENTROPY | PC1 | PC2 | MODEL_METADATA | FEATURE_ZSCORES
//
// MODEL_METADATA (same value every row) carries algorithm, n_clusters, n_features,
// feature_names, global_silhouette_avg, cluster_profiles (per-cluster z-scores +
// means), cluster_sizes, and pca (explained_variance_ratio, loadings).
// ---------------------------------------------------------------------------

export function fromResultTable(data: Record<string, unknown>): SegmentationData | null {
  const results = data["results"] as { headers: string[]; rows: (string | number)[][] } | undefined;
  if (!results || !Array.isArray(results.headers) || !Array.isArray(results.rows) || results.rows.length === 0) return null;

  // Normalise headers to upper-case, no spaces
  const rawHeaders = results.headers;
  const headers = rawHeaders.map((h) => String(h).toUpperCase().replace(/\s+/g, "_"));

  // Must have at minimum CLUSTER_ID to be a clustering result
  if (!headers.includes("CLUSTER_ID") && !headers.includes("CLUSTERID")) return null;

  const col = (name: string) => {
    const idx = headers.indexOf(name);
    return idx >= 0 ? idx : headers.indexOf(name.replace(/_/g, ""));
  };

  const ciClusterId     = col("CLUSTER_ID");
  const ciClusterLabel  = col("CLUSTER_LABEL");
  const ciPc1           = col("PC1");
  const ciPc2           = col("PC2");
  const ciModelMeta     = col("MODEL_METADATA");
  const ciRecordId      = col("RECORD_ID");
  const ciProbability   = col("CLUSTER_PROBABILITY");
  const ciEntropy       = col("CLUSTER_ENTROPY");

  const rows = results.rows;

  // ── Parse MODEL_METADATA from first row (identical for all rows)
  type ClusterProfile = Record<string, { mean?: number; z_score?: number } | string | number>;
  interface ModelMetaShape {
    algorithm?: string;
    n_clusters?: number;
    n_features?: number;
    feature_names?: string[];
    global_silhouette_avg?: number;
    model_confidence_label?: string;
    cluster_profiles?: Record<string, ClusterProfile>;
    cluster_sizes?: Record<string, number>;
    pca?: {
      n_components?: number;
      explained_variance_ratio?: number[];
      cumulative_variance?: number;
    };
  }
  let modelMeta: ModelMetaShape = {};
  if (ciModelMeta >= 0) {
    const raw = rows[0]?.[ciModelMeta];
    if (typeof raw === "string") {
      try { modelMeta = JSON.parse(raw) as ModelMetaShape; } catch { /* malformed */ }
    }
  }

  const algorithm    = modelMeta.algorithm?.toUpperCase().replace(/[- ]/g, "_");
  const nClusters    = modelMeta.n_clusters;
  const featureNames = modelMeta.feature_names ?? [];
  const silhouette   = modelMeta.global_silhouette_avg;
  const totalRecords = modelMeta.cluster_sizes
    ? Object.values(modelMeta.cluster_sizes).reduce((s, n) => s + n, 0)
    : rows.length;
  const varRatio     = modelMeta.pca?.explained_variance_ratio;

  // ── Build segments from cluster_profiles in MODEL_METADATA
  const segments: SegmentProfile[] = [];
  const clusterProfiles = modelMeta.cluster_profiles ?? {};

  for (const [clusterIdStr, profile] of Object.entries(clusterProfiles)) {
    const id   = parseInt(clusterIdStr);
    const size = modelMeta.cluster_sizes?.[clusterIdStr] ?? 0;
    const pct  = totalRecords > 0 ? (size / totalRecords) * 100 : 0;

    // Get the human-readable label from the first matching row
    const labelRow = ciClusterLabel >= 0
      ? rows.find((r) => String(r[ciClusterId]) === clusterIdStr)
      : undefined;
    const rawLabel  = labelRow ? String(labelRow[ciClusterLabel]) : "";
    // Strip leading "Segment N: " or "Cluster N: " prefix
    const nameMatch = rawLabel.match(/^(?:Segment|Cluster)\s+\d+\s*[:\-–—]\s*(.+)$/i);
    const name      = nameMatch?.[1]?.trim() || rawLabel || `Segment ${id}`;

    const avgValues: Record<string, number> = {};
    const zScores: Record<string, number>   = {};
    let topDriver: string | undefined;

    for (const [feat, val] of Object.entries(profile)) {
      if (feat === "_TOP_DRIVER") {
        topDriver = String(val);
        continue;
      }
      if (feat === "_TOP_DRIVER_ZSCORE") continue;
      const featureData = val as { mean?: number; z_score?: number } | null;
      if (featureData && typeof featureData === "object") {
        if (typeof featureData.mean    === "number") avgValues[feat] = featureData.mean;
        if (typeof featureData.z_score === "number") zScores[feat]   = featureData.z_score;
      }
    }

    const topDriverZ = profile["_TOP_DRIVER_ZSCORE"];
    const topDriverLabel = topDriver
      ? `${topDriver} (Z=${typeof topDriverZ === "number" ? topDriverZ.toFixed(2) : "?"})`
      : undefined;

    segments.push({ id, name, size, pct, characteristics: [], avgValues, zScores, topDriver: topDriverLabel, description: undefined });
  }

  // Sort by id
  segments.sort((a, b) => a.id - b.id);

  // ── If no cluster_profiles (older schema), aggregate from rows
  if (segments.length === 0) {
    const grouped = new Map<string, (string | number)[][]>();
    for (const row of rows) {
      const key = String(row[ciClusterId]);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }
    for (const [key, clRows] of grouped) {
      const id   = parseInt(key);
      const size = clRows.length;
      const pct  = totalRecords > 0 ? (size / totalRecords) * 100 : 0;
      const rawLabel  = ciClusterLabel >= 0 ? String(clRows[0][ciClusterLabel]) : "";
      const nameMatch = rawLabel.match(/^(?:Segment|Cluster)\s+\d+\s*[:\-–—]\s*(.+)$/i);
      const name      = nameMatch?.[1]?.trim() || rawLabel || `Segment ${id}`;
      segments.push({ id, name, size, pct, characteristics: [], avgValues: {}, description: undefined });
    }
    segments.sort((a, b) => a.id - b.id);
  }

  // ── Build PCA points from per-row PC1 / PC2 columns
  const pcaPoints: PcaPoint[] = [];
  if (ciPc1 >= 0 && ciPc2 >= 0) {
    for (const row of rows) {
      const pc1     = Number(row[ciPc1]);
      const pc2     = Number(row[ciPc2]);
      const cluster = parseInt(String(row[ciClusterId]));
      if (!isNaN(pc1) && !isNaN(pc2) && !isNaN(cluster)) {
        pcaPoints.push({ pc1, pc2, cluster });
      }
    }
  }

  // ── Build membership table
  const membershipTable: MemberRecord[] = rows.map((row) => {
    const rec: MemberRecord = {
      id:      ciRecordId >= 0 ? row[ciRecordId] : "?",
      cluster: parseInt(String(row[ciClusterId])),
      clusterName: ciClusterLabel >= 0
        ? String(row[ciClusterLabel]).replace(/^(?:Segment|Cluster)\s+\d+\s*[:\-–—]\s*/i, "").trim()
        : undefined,
    };
    if (ciProbability >= 0) rec["Probability"] = Number(row[ciProbability]).toFixed(3);
    if (ciEntropy     >= 0) rec["Entropy"]      = Number(row[ciEntropy]).toFixed(3);
    return rec;
  });

  return {
    algorithm,
    totalRecords,
    featuresUsed: featureNames.length > 0 ? featureNames : undefined,
    clusterCount: nClusters ?? segments.length,
    clusterCountMethod: "auto",
    silhouetteScore: silhouette,
    segments,
    pcaPoints: pcaPoints.length > 0 ? pcaPoints : undefined,
    pc1Label: "PC1",
    pc2Label: "PC2",
    pc1Variance: varRatio?.[0] != null ? varRatio[0] * 100 : undefined,
    pc2Variance: varRatio?.[1] != null ? varRatio[1] * 100 : undefined,
    membershipTable: membershipTable.length > 0 ? membershipTable : undefined,
  };
}

// ---------------------------------------------------------------------------
// Model Performance Card
// ---------------------------------------------------------------------------

function ModelPerformanceCard({ data }: { data: SegmentationData }) {
  const silhouette = data.silhouetteScore;
  const silLabel =
    silhouette == null ? "—"
    : silhouette >= 0.7 ? "Excellent"
    : silhouette >= 0.5 ? "Good"
    : silhouette >= 0.25 ? "Fair"
    : "Weak";
  const silColor =
    silhouette == null ? "var(--text-muted)"
    : silhouette >= 0.7 ? "#16a34a"
    : silhouette >= 0.5 ? "#ca8a04"
    : silhouette >= 0.25 ? "#ea580c"
    : "#e11d48";

  const silInterpretation =
    silhouette == null ? null
    : silhouette >= 0.7
      ? "Segments are very well-separated and distinct. You can confidently act on these groups — they reflect genuinely different populations."
      : silhouette >= 0.5
      ? "Segments show good separation with minimal overlap. The groupings are reliable for most downstream uses."
      : silhouette >= 0.25
      ? "Segments have acceptable but noticeable overlap. Use them directionally; some members near the boundary may belong to adjacent groups."
      : "Segments overlap significantly. Treat this clustering with caution — results may not be stable across different runs or subsets.";

  const confidenceDisplay =
    data.confidenceLevel == null ? null
    : data.confidenceLevel <= 1
    ? `${(data.confidenceLevel * 100).toFixed(0)}%`
    : `${data.confidenceLevel.toFixed(0)}%`;

  return (
    <div className="rounded-2xl p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      <SectionTitle icon={<BarChart2 size={15} />} title="Model Performance" />

      {/* ── Metric pills row ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-4">
        {data.algorithm && <MetricPill label="Algorithm" value={data.algorithm.replace(/_/g, "-")} />}
        {data.totalRecords != null && data.totalRecords > 0 && (
          <MetricPill label="Records Analyzed" value={data.totalRecords.toLocaleString()} />
        )}
        {data.clusterCount != null && (
          <MetricPill
            label={`Clusters (${data.clusterCountMethod === "user" ? "user-defined" : "auto-selected"})`}
            value={data.clusterCount}
          />
        )}
        {confidenceDisplay != null && (
          <MetricPill label="Confidence Level" value={confidenceDisplay} />
        )}
      </div>

      {/* ── Silhouette Score bar + interpretation ─────────────────────────── */}
      {silhouette != null && (
        <div className="rounded-xl p-3 mb-3" style={{ background: "var(--bg-primary, #f8fafc)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-4">
            {/* Compact bar */}
            <div className="flex flex-col gap-1" style={{ minWidth: 140, maxWidth: 180, flex: "0 0 auto" }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>Silhouette Score</span>
                <span className="text-[11px] font-bold ml-2" style={{ color: silColor }}>
                  {silhouette.toFixed(3)}
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(Math.max((silhouette + 1) / 2, 0), 1) * 100}%`,
                    background: silColor,
                    transition: "width 0.6s ease",
                  }}
                />
              </div>
              <div className="flex justify-between">
                <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>–1</span>
                <span className="text-[10px] font-semibold" style={{ color: silColor }}>{silLabel}</span>
                <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>+1</span>
              </div>
            </div>

            {/* Divider */}
            <div style={{ width: 1, alignSelf: "stretch", background: "var(--border)", flexShrink: 0 }} />

            {/* Interpretation */}
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold mb-0.5" style={{ color: silColor }}>
                {silLabel} separation
              </p>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {silInterpretation}
              </p>
              <p className="text-[10px] mt-1 italic" style={{ color: "var(--text-muted)", opacity: 0.7 }}>
                Silhouette measures how closely each member fits its own segment vs. the nearest neighbouring segment (range –1 to +1).
              </p>
            </div>
          </div>
        </div>
      )}

      {data.interpretation && !/^#+\s/.test(data.interpretation) && (
        <p className="text-xs leading-relaxed mt-2" style={{ color: "var(--text-secondary)" }}>
          {data.interpretation}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Features Used Card (collapsible)
// ---------------------------------------------------------------------------

function FeaturesUsedCard({ features, onDownload }: { features: string[]; onDownload: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...features].sort((a, b) => a.localeCompare(b));

  return (
    <div className="rounded-2xl" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      {/* Header — always visible, clickable to toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 rounded-2xl hover:bg-black/4 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Table2 size={15} style={{ color: "var(--text-muted)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Features Used in Segmentation
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: "var(--border)", color: "var(--text-muted)" }}
          >
            {features.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {expanded ? "Collapse" : "Expand"}
          </span>
          <svg
            width="14" height="14"
            viewBox="0 0 14 14"
            fill="none"
            style={{
              color: "var(--text-muted)",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease",
            }}
          >
            <path d="M2 4.5L7 9.5L12 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-5 pb-4" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mt-3 mb-2">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              These {features.length} variables were used as inputs to the segmentation model.
            </p>
            <DownloadButton label="CSV" onClick={onDownload} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sorted.map((f, i) => (
              <span
                key={i}
                className="text-xs px-2.5 py-1 rounded-lg"
                style={{ background: "var(--bg-primary, #f1f5f9)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PPTX export helpers for charts
// ---------------------------------------------------------------------------

async function exportPcaToPptx(
  points: PcaPoint[],
  segmentNames: Record<number, string>,
  pc1Label?: string,
  pc2Label?: string,
  pc1Variance?: number,
  pc2Variance?: number,
) {
  try {
    const pptxgen = (await import("pptxgenjs")).default;
    const prs = new pptxgen();
    prs.layout = "LAYOUT_WIDE";
    const slide = prs.addSlide();

    const varNote = pc1Variance != null && pc2Variance != null
      ? ` | PC1 explains ${pc1Variance.toFixed(1)}% var., PC2 explains ${pc2Variance.toFixed(1)}% var.`
      : "";
    slide.addText(`Segment Separation – PCA Chart${varNote}`, {
      x: 0.4, y: 0.2, w: 12.6, fontSize: 14, bold: true, color: "333333",
    });

    // Group by cluster
    const grouped: Record<number, PcaPoint[]> = {};
    for (const p of points) {
      if (!grouped[p.cluster]) grouped[p.cluster] = [];
      grouped[p.cluster].push(p);
    }

    // Build scatter series — pptxgenjs uses values (Y) + labels (X as strings)
    const chartData = Object.entries(grouped).map(([cluster, pts]) => ({
      name: segmentNames[Number(cluster)] ?? `Cluster ${cluster}`,
      values: pts.map((p) => p.pc2),
      labels: pts.map((p) => p.pc1.toFixed(3)),
    }));

    slide.addChart("scatter" as Parameters<typeof slide.addChart>[0], chartData, {
      x: 0.4, y: 0.7, w: 12, h: 5.8,
      showTitle: false,
      catAxisTitle: pc1Label ?? "PC1",
      valAxisTitle: pc2Label ?? "PC2",
      showLegend: true,
      legendPos: "b",
      dataLabelFontSize: 9,
    });

    await prs.writeFile({ fileName: "pca_chart.pptx" });
  } catch {
    // fallback: CSV of the points
    downloadCSV(
      "pca_points.csv",
      ["PC1", "PC2", "Cluster", "SegmentName"],
      points.map((p) => [p.pc1, p.pc2, p.cluster, segmentNames[p.cluster] ?? ""]),
    );
  }
}

async function exportSnakePlotToPptx(segments: SegmentProfile[]) {
  try {
    const pptxgen = (await import("pptxgenjs")).default;
    const prs = new pptxgen();
    prs.layout = "LAYOUT_WIDE";
    const slide = prs.addSlide();

    slide.addText("Z-Score Snake Plot", {
      x: 0.4, y: 0.2, w: 12.6, fontSize: 14, bold: true, color: "333333",
    });

    const snakeData = buildSnakePlotData(segments);
    if (snakeData.length === 0) {
      slide.addText("No z-score data available.", { x: 0.4, y: 0.8, w: 12, fontSize: 12, color: "666666" });
    } else {
      const features = snakeData.map((r) => String(r["feature"]));
      const chartData = segments.map((seg) => ({
        name: seg.name,
        labels: features,
        values: snakeData.map((r) => Number(r[String(seg.id)] ?? 0)),
      }));

      slide.addChart("line" as Parameters<typeof slide.addChart>[0], chartData, {
        x: 0.4, y: 0.7, w: 12, h: 5.8,
        showTitle: false,
        showLegend: true,
        legendPos: "b",
        valAxisTitle: "Z-Score",
        valAxisMinVal: -3,
        valAxisMaxVal: 3,
        dataLabelFontSize: 8,
      });
    }

    await prs.writeFile({ fileName: "zscores_snake_plot.pptx" });
  } catch {
    const snakeData = buildSnakePlotData(segments);
    const headers = ["Feature", ...segments.map((s) => s.name)];
    const rows = snakeData.map((row) => [
      String(row["feature"]),
      ...segments.map((s) => Number(row[String(s.id)] ?? 0).toFixed(3)),
    ]);
    downloadCSV("zscores_snake.csv", headers, rows);
  }
}

// ---------------------------------------------------------------------------
// Segment Profiles Grid
// ---------------------------------------------------------------------------

function SegmentProfileCard({ seg, index }: { seg: SegmentProfile; index: number }) {
  const pal = PALETTES[index % PALETTES.length];

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: pal.bg, border: `1.5px solid ${pal.border}` }}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold" style={{ color: pal.text }}>{seg.name}</span>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: `${pal.accent}18`, color: pal.accent, border: `1px solid ${pal.border}` }}
            >
              Segment ID #{seg.id}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {seg.size > 0 && (
              <span className="text-xs" style={{ color: "#666" }}>
                {seg.size.toLocaleString()} members
              </span>
            )}
            {seg.pct > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: `${pal.accent}12`, color: pal.text, border: `1px solid ${pal.border}` }}
              >
                {seg.pct.toFixed(1)}% of total members
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Size bar */}
      {seg.pct > 0 && (
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${pal.accent}20` }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(seg.pct, 100)}%`, background: pal.accent, opacity: 0.75 }}
          />
        </div>
      )}

      {/* Description */}
      {seg.description && (
        <p className="text-xs leading-relaxed" style={{ color: "#555" }}>{seg.description}</p>
      )}

      {/* Top driver */}
      {seg.topDriver && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium" style={{ color: pal.accent }}>Top Driver:</span>
          <span className="text-xs" style={{ color: "#444" }}>{seg.topDriver}</span>
        </div>
      )}

      {/* Domain metrics */}
      {(seg.uniquePatients != null || seg.livesCovered != null || seg.topRegimen) && (
        <div className="flex flex-wrap gap-2 pt-1" style={{ borderTop: `1px solid ${pal.border}` }}>
          {seg.uniquePatients != null && (
            <span className="text-xs px-2 py-0.5 rounded-lg" style={{ background: `${pal.accent}12`, color: pal.text }}>
              👤 {seg.uniquePatients.toLocaleString()} pts
            </span>
          )}
          {seg.livesCovered != null && (
            <span className="text-xs px-2 py-0.5 rounded-lg" style={{ background: `${pal.accent}12`, color: pal.text }}>
              🏥 {seg.livesCovered.toLocaleString()} lives
            </span>
          )}
          {seg.topRegimen && (
            <span className="text-xs px-2 py-0.5 rounded-lg" style={{ background: `${pal.accent}12`, color: pal.text }}>
              💊 {seg.topRegimen}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SegmentProfilesSection({ segments, onDownload }: { segments: SegmentProfile[]; onDownload: () => void }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle icon={<Users size={15} />} title="Segment Profiles" />
        <DownloadButton label="PPTX" onClick={onDownload} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {segments.map((seg, i) => (
          <SegmentProfileCard key={`seg-${i}`} seg={seg} index={i} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PCA Scatter Plot
// ---------------------------------------------------------------------------

interface PcaScatterProps {
  points: PcaPoint[];
  pc1Label?: string;
  pc2Label?: string;
  pc1Variance?: number;
  pc2Variance?: number;
  pc1TopFeatures?: string[];
  pc2TopFeatures?: string[];
  segmentNames: Record<number, string>;
  height?: number;
}

function PcaScatterChart({ points, pc1Label, pc2Label, pc1Variance, pc2Variance, pc1TopFeatures, pc2TopFeatures, segmentNames, height = 340 }: PcaScatterProps) {
  const grouped: Record<number, { pc1: number; pc2: number; cluster: number; name: string; pct?: number }[]> = {};
  for (const p of points) {
    if (!grouped[p.cluster]) grouped[p.cluster] = [];
    grouped[p.cluster].push({ pc1: p.pc1, pc2: p.pc2, cluster: p.cluster, name: segmentNames[p.cluster] ?? `Cluster ${p.cluster}`, pct: p.pct });
  }

  // Bubble mode: every cluster collapses to a single distinct (pc1, pc2) position.
  // This happens when data comes from narrative-parsed centroids or when each cluster
  // has multiple members that share identical coordinates.
  const isBubbleMode = Object.values(grouped).every((pts) => {
    if (pts.length <= 1) return true;
    const { pc1: refX, pc2: refY } = pts[0];
    return pts.every((p) => Math.abs(p.pc1 - refX) < 1e-6 && Math.abs(p.pc2 - refY) < 1e-6);
  });

  // For bubble mode: compute radius from segment pct (sqrt scale keeps area proportional)
  const pctValues = Object.values(grouped)
    .map((pts) => pts[0]?.pct ?? 0)
    .filter((v) => v > 0);
  const maxPct = pctValues.length > 0 ? Math.max(...pctValues) : 100;
  const bubbleRadius = (pct: number | undefined) => {
    const p = pct && pct > 0 ? pct : maxPct / 2;
    return 10 + Math.sqrt(p / maxPct) * 20; // 10 – 30 px
  };

  // Build axis labels — prefer dominant feature name when available
  const pc1Dominant = pc1TopFeatures && pc1TopFeatures.length > 0 ? pc1TopFeatures[0] : null;
  const pc2Dominant = pc2TopFeatures && pc2TopFeatures.length > 0 ? pc2TopFeatures[0] : null;

  const xLabel = pc1Dominant
    ? `PC1: ${pc1Dominant}${pc1Variance != null ? ` (${pc1Variance.toFixed(1)}% var.)` : ""}`
    : pc1Variance != null
      ? `${pc1Label ?? "PC1"} (${pc1Variance.toFixed(1)}% var.)`
      : (pc1Label ?? "PC1");

  const yLabel = pc2Dominant
    ? `PC2: ${pc2Dominant}${pc2Variance != null ? ` (${pc2Variance.toFixed(1)}% var.)` : ""}`
    : pc2Variance != null
      ? `${pc2Label ?? "PC2"} (${pc2Variance.toFixed(1)}% var.)`
      : (pc2Label ?? "PC2");

  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* Extra bottom margin so legend doesn't collide with X-axis label */}
      {/* left:90 reserves space for the rotated Y-axis title outside the tick numbers */}
      <ScatterChart margin={{ top: 20, right: 50, bottom: 55, left: 90 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis
          dataKey="pc1"
          type="number"
          name="PC1"
          tick={{ fontSize: 10 }}
          label={{ value: xLabel, position: "insideBottom", offset: -30, fontSize: 10, fill: "#888" }}
        />
        <YAxis
          dataKey="pc2"
          type="number"
          name="PC2"
          tick={{ fontSize: 10 }}
          width={55}
          label={(props: { viewBox?: { x: number; y: number; width: number; height: number } }) => {
            const vb = props.viewBox ?? { x: 0, y: 0, width: 55, height: 340 };
            // Place the label to the LEFT of the tick numbers:
            // vb.x is the left edge of the plot area; subtract enough to clear the tick numbers (~40px wide)
            const cx = vb.x - 38;
            const cy = vb.y + vb.height / 2;
            return (
              <text
                x={cx}
                y={cy}
                transform={`rotate(-90, ${cx}, ${cy})`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10}
                fill="#888"
              >
                {yLabel}
              </text>
            );
          }}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as { pc1: number; pc2: number; cluster: number; name: string; pct?: number };
            return (
              <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                <p className="font-semibold mb-0.5">{d.name}</p>
                {d.pct != null && d.pct > 0 && <p style={{ color: "var(--text-muted)" }}>{d.pct.toFixed(1)}% of population</p>}
                <p style={{ color: "var(--text-muted)" }}>PC1: {d.pc1.toFixed(3)}</p>
                <p style={{ color: "var(--text-muted)" }}>PC2: {d.pc2.toFixed(3)}</p>
              </div>
            );
          }}
        />
        {/* Legend at top to prevent overlap with X-axis labels at bottom */}
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 12, fontSize: 11 }}
          formatter={(value) => segmentNames[Number(value)] ?? value}
        />
        {Object.entries(grouped).map(([cluster, pts]) => (
          <Scatter
            key={cluster}
            name={cluster}
            data={pts}
            fill={STROKE_COLORS[Number(cluster) % STROKE_COLORS.length]}
            opacity={isBubbleMode ? 0.85 : 0.65}
            // Bubble mode: halo ring + solid core sized by segment pct, with label
            shape={isBubbleMode ? (props: ScatterShapeProps) => {
              const cx = (props as unknown as Record<string, number>)["cx"] ?? 0;
              const cy = (props as unknown as Record<string, number>)["cy"] ?? 0;
              const fill = STROKE_COLORS[Number(cluster) % STROKE_COLORS.length];
              const label = segmentNames[Number(cluster)] ?? `Cluster ${cluster}`;
              const shortLabel = label.length > 16 ? label.slice(0, 14) + "…" : label;
              const pctVal = (props as unknown as Record<string, number | undefined>)["pct"];
              const r = bubbleRadius(pctVal);
              return (
                <g>
                  {/* outer halo — semi-transparent, area ∝ cluster size */}
                  <circle cx={cx} cy={cy} r={r * 1.6} fill={fill} opacity={0.12} />
                  {/* mid ring */}
                  <circle cx={cx} cy={cy} r={r * 1.1} fill="none" stroke={fill} strokeWidth={1} opacity={0.3} />
                  {/* solid core */}
                  <circle cx={cx} cy={cy} r={r * 0.55} fill={fill} opacity={0.9} />
                  {/* segment label above bubble */}
                  <text
                    x={cx}
                    y={cy - r * 1.7}
                    textAnchor="middle"
                    fontSize={9}
                    fontWeight={600}
                    fill={fill}
                    style={{ pointerEvents: "none" }}
                  >
                    {shortLabel}
                  </text>
                  {/* pct label inside core */}
                  {pctVal != null && pctVal > 0 && (
                    <text
                      x={cx}
                      y={cy + 4}
                      textAnchor="middle"
                      fontSize={8}
                      fontWeight={700}
                      fill="#fff"
                      style={{ pointerEvents: "none" }}
                    >
                      {pctVal.toFixed(0)}%
                    </text>
                  )}
                </g>
              );
            } : undefined}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Z-score Snake Plot
// ---------------------------------------------------------------------------

interface SnakePlotProps {
  segments: SegmentProfile[];
  height?: number;
}

function buildSnakePlotData(segments: SegmentProfile[]) {
  const allKeys = Array.from(new Set(segments.flatMap((s) => Object.keys(s.zScores ?? {}))));
  // Sort keys alphabetically, limit to 12
  const keys = allKeys.sort().slice(0, 12);

  return keys.map((key) => {
    const row: Record<string, number | string> = { feature: key };
    for (const seg of segments) {
      row[String(seg.id)] = (seg.zScores ?? {})[key] ?? 0;
    }
    return row;
  });
}

function ZSnakePlot({ segments, height = 400 }: SnakePlotProps) {
  const [hoveredSeg, setHoveredSeg] = useState<string | null>(null);

  const hasZScores = segments.some((s) => s.zScores && Object.keys(s.zScores).length > 0);
  if (!hasZScores) return null;

  const snakeData = buildSnakePlotData(segments);
  if (snakeData.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={snakeData} margin={{ top: 10, right: 30, bottom: 70, left: 45 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis
          dataKey="feature"
          tick={{ fontSize: 9 }}
          angle={-40}
          textAnchor="end"
          interval={0}
          height={70}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          label={{ value: "Z-Score", angle: -90, position: "insideLeft", offset: 15, fontSize: 11, fill: "#888" }}
          width={40}
        />
        <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 4" strokeWidth={1.5} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            return (
              <div className="rounded-lg px-3 py-2 text-xs shadow-lg" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                <p className="font-semibold mb-1">{label}</p>
                {payload.map((p, pi) => {
                  const keyStr = String(p.dataKey ?? pi);
                  const seg = segments.find((s) => String(s.id) === keyStr);
                  return (
                    <p key={pi} style={{ color: p.color }}>
                      {seg?.name ?? keyStr}: {Number(p.value).toFixed(2)}
                    </p>
                  );
                })}
              </div>
            );
          }}
        />
        {/* Custom legend at top — hover to highlight */}
        <Legend
          verticalAlign="top"
          wrapperStyle={{ paddingBottom: 12 }}
          content={({ payload }) => (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", justifyContent: "center", paddingBottom: 4 }}>
              {(payload ?? []).map((entry, ei) => {
                const keyStr = String((entry as unknown as Record<string, unknown>)["dataKey"] ?? entry.value ?? ei);
                const seg = segments.find((s) => String(s.id) === keyStr);
                const name = seg?.name ?? String(entry.value ?? keyStr);
                const isActive = hoveredSeg === keyStr;
                const isDimmed = hoveredSeg !== null && !isActive;
                return (
                  <div
                    key={ei}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      cursor: "pointer",
                      opacity: isDimmed ? 0.35 : 1,
                      transition: "opacity 0.15s",
                    }}
                    onMouseEnter={() => setHoveredSeg(keyStr)}
                    onMouseLeave={() => setHoveredSeg(null)}
                  >
                    <div style={{
                      width: 16, height: 3, borderRadius: 2,
                      background: entry.color as string,
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{name}</span>
                  </div>
                );
              })}
            </div>
          )}
        />
        {segments.map((seg, i) => {
          const key = String(seg.id);
          const isHighlighted = hoveredSeg === null || hoveredSeg === key;
          const baseColor = STROKE_COLORS[i % STROKE_COLORS.length];
          const strokeColor = isHighlighted ? baseColor : "#d1d5db";
          const sw = hoveredSeg !== null && !isHighlighted ? 1 : 2.5;
          return (
            <Line
              key={seg.id}
              type="monotone"
              dataKey={key}
              stroke={strokeColor}
              strokeWidth={sw}
              dot={{ r: isHighlighted ? 3 : 2, fill: strokeColor }}
              activeDot={{ r: 5 }}
              opacity={isHighlighted ? 1 : 0.5}
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Z-Score Heatmap
// ---------------------------------------------------------------------------

interface HeatmapProps {
  segments: SegmentProfile[];
}

/** Convert a z-score to a CSS rgb() colour: red = below average, green = above average.
 *  Neutral baseline is rgb(245,245,245) instead of pure white. */
function zToHeatColor(z: number, maxAbs: number): string {
  const BASE = 245; // neutral mid-point
  const t = Math.max(-1, Math.min(1, z / Math.max(maxAbs, 0.01)));
  if (t < 0) {
    // below average → red shades (245,245,245 → 255,67,67)
    const intensity = Math.abs(t);
    const r = BASE;
    const g = Math.round(BASE - intensity * 178); // 245 → 67
    const b = Math.round(BASE - intensity * 178);
    return `rgb(${r},${g},${b})`;
  } else {
    // above average → green shades (245,245,245 → 67,225,67)
    const intensity = t;
    const r = Math.round(BASE - intensity * 178); // 245 → 67
    const g = Math.round(BASE - intensity * 10);  // 245 → 235 (stays high)
    const b = Math.round(BASE - intensity * 178); // 245 → 67
    return `rgb(${r},${g},${b})`;
  }
}

function ZScoreHeatmap({ segments }: HeatmapProps) {
  const allKeys = Array.from(
    new Set(segments.flatMap((s) => Object.keys(s.zScores ?? {})))
  ).sort().slice(0, 16); // cap at 16 features

  if (allKeys.length === 0) return null;

  const allVals = segments.flatMap((s) =>
    allKeys.map((k) => (s.zScores ?? {})[k]).filter((v): v is number => v != null && !isNaN(v))
  );
  const maxAbs = allVals.length > 0 ? Math.max(...allVals.map(Math.abs), 0.01) : 1;

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          fontSize: 11,
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          <col style={{ width: "160px" }} />
          {segments.map((s) => (
            <col key={s.id} style={{ width: `${Math.max(64, Math.floor(100 / segments.length))}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              style={{
                textAlign: "left",
                padding: "5px 8px",
                color: "var(--text-muted)",
                fontWeight: 500,
                fontSize: 10,
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-secondary)",
              }}
            >
              Feature
            </th>
            {segments.map((s) => (
              <th
                key={s.id}
                title={s.name}
                style={{
                  padding: "5px 6px",
                  color: "var(--text-muted)",
                  fontWeight: 500,
                  fontSize: 10,
                  textAlign: "center",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-secondary)",
                }}
              >
                {s.name.length > 13 ? s.name.slice(0, 11) + "…" : s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allKeys.map((key, rowIdx) => (
            <tr key={key}>
              <td
                title={key}
                style={{
                  padding: "3px 8px",
                  color: "var(--text-secondary)",
                  fontSize: 10,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  borderTop: rowIdx === 0 ? undefined : "1px solid rgba(0,0,0,0.04)",
                  background: "var(--bg-secondary)",
                }}
              >
                {key}
              </td>
              {segments.map((s, si) => {
                const z = (s.zScores ?? {})[key];
                const hasVal = z != null && !isNaN(z);
                const bg = hasVal ? zToHeatColor(z, maxAbs) : "var(--bg-secondary)";
                // Use white text when background is saturated
                const saturation = hasVal ? Math.abs(z) / maxAbs : 0;
                const textColor = saturation > 0.45 ? "#fff" : "rgba(0,0,0,0.75)";
                return (
                  <td
                    key={si}
                    title={hasVal ? `${key} / ${s.name}: ${z.toFixed(3)}` : undefined}
                    style={{
                      padding: "3px 4px",
                      textAlign: "center",
                      background: bg,
                      color: textColor,
                      border: "1px solid rgba(0,0,0,0.04)",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 10,
                      fontWeight: hasVal && Math.abs(z) > maxAbs * 0.6 ? 600 : 400,
                    }}
                  >
                    {hasVal ? z.toFixed(2) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Colour legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 10,
          fontSize: 10,
          color: "var(--text-muted)",
        }}
      >
        <span>−{maxAbs.toFixed(2)}</span>
        <div
          style={{
            flex: 1,
            maxWidth: 140,
            height: 8,
            background: "linear-gradient(to right, rgb(255,67,67), rgb(245,245,245), rgb(67,235,67))",
            borderRadius: 4,
            border: "1px solid rgba(0,0,0,0.08)",
          }}
        />
        <span>+{maxAbs.toFixed(2)}</span>
        <span style={{ marginLeft: 6, opacity: 0.7 }}>
          (red = below avg, green = above avg)
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Caveats Card
// ---------------------------------------------------------------------------

const METADATA_PATTERN = /algorithm.*duration.*cache|duration:\s*\d+ms|cache:\s*(miss|hit)/i;

function CaveatsCard({ caveats }: { caveats: string[] }) {
  const filtered = caveats.filter((c) => !METADATA_PATTERN.test(c));
  if (!filtered || filtered.length === 0) return null;
  return (
    <div className="rounded-2xl p-5" style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
      <SectionTitle icon={<AlertCircle size={15} />} title="Caveats & Limitations" />
      <ul className="flex flex-col gap-2">
        {filtered.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "#92400e" }}>
            <span className="mt-0.5 shrink-0 text-amber-500">⚠</span>
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Membership Table
// ---------------------------------------------------------------------------

interface MembershipTableProps {
  members: MemberRecord[];
  segmentNames: Record<number, string>;
  onDownloadCSV: () => void;
  onFullscreen: () => void;
}

function MembershipTable({ members, segmentNames, onDownloadCSV, onFullscreen }: MembershipTableProps) {
  if (members.length === 0) return null;

  const headers = ["ID", "Name", "Segment", ...Object.keys(members[0]).filter((k) => !["id", "name", "cluster", "clusterName"].includes(k))];
  const PAGE = 50;
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(members.length / PAGE);
  const visibleMembers = members.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="rounded-2xl p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-3">
        <SectionTitle icon={<Table2 size={15} />} title={`Segment Membership (${members.length.toLocaleString()} records)`} />
        <div className="flex items-center gap-2">
          <DownloadButton label="CSV" onClick={onDownloadCSV} />
          <button
            onClick={onFullscreen}
            className="p-1.5 rounded-lg hover:bg-black/6 transition-colors"
            style={{ color: "var(--text-muted)" }}
            title="Fullscreen"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto max-h-72 overflow-y-auto rounded-xl" style={{ border: "1px solid var(--border)" }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: "var(--bg-tertiary, #f8f9fa)" }}>
              {headers.map((h) => (
                <th key={h} className="px-3 py-2 text-left font-semibold sticky top-0" style={{ color: "var(--text-muted)", background: "var(--bg-tertiary, #f8f9fa)", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleMembers.map((m, i) => {
              const pal = PALETTES[m.cluster % PALETTES.length];
              return (
                <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>{String(m.id)}</td>
                  <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>{m.name ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: `${pal.accent}18`, color: pal.accent }}>
                      {m.clusterName ?? segmentNames[m.cluster] ?? `Cluster ${m.cluster}`}
                    </span>
                  </td>
                  {headers.slice(3).map((h) => (
                    <td key={h} className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                      {m[h] != null ? String(m[h]) : "—"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded text-xs disabled:opacity-40"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="px-2 py-1 rounded text-xs disabled:opacity-40"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-muted)" }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SegmentationArtifact component
// ---------------------------------------------------------------------------

interface Props {
  artifact: AgentArtifact;
}

export default function SegmentationArtifact({ artifact }: Props) {
  const [fullscreen, setFullscreen] = useState<"pca" | "snake" | "heatmap" | "table" | null>(null);
  const pcaRef = useRef<HTMLDivElement>(null);
  const snakeRef = useRef<HTMLDivElement>(null);

  // ── Resolve data ──────────────────────────────────────────────────────────
  // Priority:
  //   1. Snowflake result table  { results: { headers, rows } }  with CLUSTER_ID column
  //   2. v2 structured data      { segments: [...] }
  //   3. Narrative text parsing  (v3 named agent)
  const rawData = artifact.data as Record<string, unknown> | null | undefined;
  let segData: SegmentationData;

  if (rawData && typeof rawData === "object") {
    // ── 1. Try result-table format first (PC1/PC2/MODEL_METADATA columns)
    const fromTable = fromResultTable(rawData);
    if (fromTable) {
      // Enrich with narrative descriptions if the table has no descriptions
      const narrativeData = artifact.narrative
        ? parseClusteringNarrative(artifact.narrative)
        : null;
      if (narrativeData && narrativeData.segments.length > 0) {
        for (const seg of fromTable.segments) {
          const narSeg = narrativeData.segments.find((ns) => ns.id === seg.id);
          if (narSeg) {
            if (!seg.description && narSeg.description) seg.description = narSeg.description;
            if (!seg.topDriver   && narSeg.topDriver)   seg.topDriver   = narSeg.topDriver;
          }
        }
        if (!fromTable.interpretation && narrativeData.interpretation) {
          fromTable.interpretation = narrativeData.interpretation;
        }
        if (!fromTable.caveats?.length && narrativeData.caveats?.length) {
          fromTable.caveats = narrativeData.caveats;
        }
      }
      segData = fromTable;

    // ── 2. v2 structured { segments: [...] } data
    } else if (Array.isArray((rawData)["segments"]) || typeof rawData["algorithm"] === "string") {
      segData = fromV2ClusterData(rawData);
      // Enrich with z-scores from narrative if segments have no z-scores yet
      if (artifact.narrative && segData.segments.some((s) => !s.zScores || Object.keys(s.zScores).length === 0)) {
        extractInlineZScores(artifact.narrative, segData.segments);
        extractMetricsIntoSegments(artifact.narrative, segData.segments);
        computeZScoresInPlace(segData.segments);
        if (!segData.pcaPoints?.length) {
          const pcaResult = computeSegmentPca(segData.segments);
          if (pcaResult && pcaResult.points.length > 0) {
            segData.pcaPoints     = pcaResult.points;
            segData.pc1Variance   = pcaResult.pc1Variance;
            segData.pc2Variance   = pcaResult.pc2Variance;
            segData.pc1TopFeatures = pcaResult.pc1TopFeatures;
            segData.pc2TopFeatures = pcaResult.pc2TopFeatures;
            segData.pc1Label = "PC1";
            segData.pc2Label = "PC2";
          }
        }
      }

    // ── 3. Fall back to narrative parsing
    } else {
      segData = parseClusteringNarrative(artifact.narrative ?? "");
    }
  } else {
    segData = parseClusteringNarrative(artifact.narrative ?? "");
  }

  const { segments, pcaPoints, membershipTable, caveats } = segData;
  const hasPca = Array.isArray(pcaPoints) && pcaPoints.length > 0;
  const hasMembership = Array.isArray(membershipTable) && membershipTable.length > 0;
  const hasZScores = segments.some((s) => s.zScores && Object.keys(s.zScores).length > 0);

  const segmentNames: Record<number, string> = {};
  segments.forEach((s) => { segmentNames[s.id] = s.name; });

  // ── Download handlers ─────────────────────────────────────────────────────
  const handleDownloadMembershipCSV = () => {
    if (!membershipTable?.length) return;
    const headers = ["ID", "Name", "Cluster", "ClusterName", ...Object.keys(membershipTable[0]).filter((k) => !["id", "name", "cluster", "clusterName"].includes(k))];
    const rows = membershipTable.map((m) => [
      String(m.id),
      m.name ?? "",
      m.cluster,
      m.clusterName ?? segmentNames[m.cluster] ?? "",
      ...headers.slice(4).map((h) => m[h] != null ? String(m[h]) : ""),
    ]);
    downloadCSV("segmentation_membership.csv", headers, rows);
  };

  const handleDownloadSegmentCSV = () => {
    const headers = ["ID", "Name", "Size", "Pct", "Characteristics"];
    const rows = segments.map((s) => [s.id, s.name, s.size, `${s.pct.toFixed(1)}%`, s.characteristics.join("; ")]);
    downloadCSV("segmentation_segments.csv", headers, rows);
  };

  const handleDownloadPptx = () => {
    exportSegmentsToPptx(segments);
  };

  // ── Fallback: no usable data ──────────────────────────────────────────────
  if (segments.length === 0 && !artifact.narrative) {
    return (
      <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
        No segmentation data available.
      </p>
    );
  }

  // Detect "failed clustering" — segments look like metric/feature names, not actual clusters
  // Only trigger when ALL segments have pct=0 AND the NAME itself reads like a metric (not a persona)
  const METRIC_NAME_RE = /number of|average|prescriptions|payment|per claim|avg\s|total\s|unique\s+drugs|unique\s+patients/i;
  const looksLikeFailed = segments.length > 0 && segments.every(
    (s) => s.pct === 0 && s.size === 0 && METRIC_NAME_RE.test(s.name)
  );

  // If we have no structured segments (or failed clustering) but have narrative text, show markdown
  if (segments.length === 0 || looksLikeFailed) {
    const displayNarrative = artifact.narrative ?? "";
    return (
      <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
          <AlertCircle size={15} />
          <span className="text-sm font-medium">Clustering could not be completed</span>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
          {displayNarrative}
        </p>
      </div>
    );
  }

  // ── Fullscreen overlays ───────────────────────────────────────────────────
  const pcaDownloadActions = (
    <div className="flex gap-2">
      <DownloadButton label="CSV" onClick={() => {
        if (!pcaPoints) return;
        const headers = ["PC1", "PC2", "Cluster", "SegmentName"];
        const rows = pcaPoints.map((p) => [p.pc1, p.pc2, p.cluster, segmentNames[p.cluster] ?? ""]);
        downloadCSV("pca_points.csv", headers, rows);
      }} />
      <DownloadButton label="PPTX" onClick={() => exportPcaToPptx(
        pcaPoints!,
        segmentNames,
        segData.pc1Label,
        segData.pc2Label,
        segData.pc1Variance,
        segData.pc2Variance,
      )} />
    </div>
  );
  const snakeDownloadActions = (
    <div className="flex gap-2">
      <DownloadButton label="CSV" onClick={() => {
        const snakeData = buildSnakePlotData(segments);
        if (!snakeData.length) return;
        const headers = ["Feature", ...segments.map((s) => s.name)];
        const rows = snakeData.map((row) => [String(row["feature"]), ...segments.map((s) => Number(row[String(s.id)] ?? 0).toFixed(3))]);
        downloadCSV("zscores_snake.csv", headers, rows);
      }} />
      <DownloadButton label="PPTX" onClick={() => exportSnakePlotToPptx(segments)} />
    </div>
  );

  const heatmapDownloadActions = (
    <div className="flex gap-2">
      <DownloadButton label="CSV" onClick={() => {
        const allKeys = Array.from(
          new Set(segments.flatMap((s) => Object.keys(s.zScores ?? {})))
        ).sort().slice(0, 16);
        if (!allKeys.length) return;
        const headers = ["Feature", ...segments.map((s) => s.name)];
        const rows = allKeys.map((k) => [
          k,
          ...segments.map((s) => {
            const z = (s.zScores ?? {})[k];
            return z != null ? z.toFixed(3) : "";
          }),
        ]);
        downloadCSV("zscores_heatmap.csv", headers, rows);
      }} />
    </div>
  );

  const hasFeaturesUsed = Array.isArray(segData.featuresUsed) && segData.featuresUsed.length > 0;

  return (
    <div className="flex flex-col gap-5 w-full">
      {/* 1. Model Performance */}
      <ModelPerformanceCard data={segData} />

      {/* 2. Features Used (collapsible) */}
      {hasFeaturesUsed && (
        <FeaturesUsedCard
          features={segData.featuresUsed!}
          onDownload={() => {
            downloadCSV(
              "features_used.csv",
              ["Feature"],
              [...segData.featuresUsed!].sort().map((f) => [f]),
            );
          }}
        />
      )}

      {/* 3. Segment Profiles */}
      <SegmentProfilesSection segments={segments} onDownload={handleDownloadPptx} />

      {/* 4. PCA / Contour Plot */}
      {hasPca && (
        <div className="rounded-2xl p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle
              icon={<Activity size={15} />}
              title={
                pcaPoints!.length <= segments.length
                  ? "Segment Separation (PCA of feature z-scores)"
                  : "Segment Contour Plot (PC1 × PC2)"
              }
            />
            <div className="flex items-center gap-2">
              {pcaDownloadActions}
              <button
                onClick={() => setFullscreen("pca")}
                className="p-1.5 rounded-lg hover:bg-black/6 transition-colors"
                style={{ color: "var(--text-muted)" }}
                title="Fullscreen"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
          {pcaPoints!.length <= segments.length && (
            <p className="text-xs mb-2" style={{ color: "var(--text-muted)" }}>
              Each bubble represents one segment centroid projected into 2-D space via PCA on the feature z-score matrix.
              Bubble size reflects segment population share. Distance between bubbles indicates how distinct segments are.
            </p>
          )}
          <div ref={pcaRef}>
            <PcaScatterChart
              points={pcaPoints!}
              pc1Label={segData.pc1Label}
              pc2Label={segData.pc2Label}
              pc1Variance={segData.pc1Variance}
              pc2Variance={segData.pc2Variance}
              pc1TopFeatures={segData.pc1TopFeatures}
              pc2TopFeatures={segData.pc2TopFeatures}
              segmentNames={segmentNames}
            />
          </div>
          {/* Variance breakdown note below chart */}
          {(segData.pc1Variance != null || segData.pc2Variance != null) && (() => {
            const v1 = segData.pc1Variance;
            const v2 = segData.pc2Variance;
            const combined = v1 != null && v2 != null ? v1 + v2 : null;
            const tf1 = segData.pc1TopFeatures?.slice(0, 2).join(", ");
            const tf2 = segData.pc2TopFeatures?.slice(0, 2).join(", ");
            return (
              <div className="mt-3 rounded-xl px-4 py-3 text-xs flex flex-wrap gap-3" style={{ background: "var(--bg-primary, #f8fafc)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                {v1 != null && (
                  <span>
                    <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>PC1</span>
                    {" — "}{v1.toFixed(1)}% of variance
                    {tf1 ? <span style={{ opacity: 0.75 }}> · driven by <em>{tf1}</em></span> : null}
                  </span>
                )}
                {v1 != null && v2 != null && <span style={{ opacity: 0.4 }}>|</span>}
                {v2 != null && (
                  <span>
                    <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>PC2</span>
                    {" — "}{v2.toFixed(1)}% of variance
                    {tf2 ? <span style={{ opacity: 0.75 }}> · driven by <em>{tf2}</em></span> : null}
                  </span>
                )}
                {combined != null && (
                  <>
                    <span style={{ opacity: 0.4 }}>|</span>
                    <span><span className="font-semibold" style={{ color: "var(--text-secondary)" }}>Combined</span>{" — "}{combined.toFixed(1)}% of total feature variance captured</span>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* 5. Z-score Snake Plot */}
      {hasZScores && (
        <div className="rounded-2xl p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle icon={<Activity size={15} />} title="Z-Score Snake Plot" />
            <div className="flex items-center gap-2">
              {snakeDownloadActions}
              <button
                onClick={() => setFullscreen("snake")}
                className="p-1.5 rounded-lg hover:bg-black/6 transition-colors"
                style={{ color: "var(--text-muted)" }}
                title="Fullscreen"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            Each line represents one segment. Peaks above 0 indicate above-average feature values; valleys below 0 indicate below-average. Hover a segment name in the legend to highlight its line.
          </p>
          <div ref={snakeRef}>
            <ZSnakePlot segments={segments} />
          </div>
        </div>
      )}

      {/* 6. Z-Score Heatmap */}
      {hasZScores && (
        <div className="rounded-2xl p-5" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <SectionTitle icon={<BarChart2 size={15} />} title="Z-Score Heatmap" />
            <div className="flex items-center gap-2">
              {heatmapDownloadActions}
              <button
                onClick={() => setFullscreen("heatmap")}
                className="p-1.5 rounded-lg hover:bg-black/6 transition-colors"
                style={{ color: "var(--text-muted)" }}
                title="Fullscreen"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
            Cells show the z-score for each segment × feature pair. Green = above average, red = below average, white = near mean.
          </p>
          <ZScoreHeatmap segments={segments} />
        </div>
      )}

      {/* 7. Caveats */}
      {caveats && caveats.length > 0 && <CaveatsCard caveats={caveats} />}

      {/* 8. Membership Table */}
      {hasMembership && (
        <MembershipTable
          members={membershipTable!}
          segmentNames={segmentNames}
          onDownloadCSV={handleDownloadMembershipCSV}
          onFullscreen={() => setFullscreen("table")}
        />
      )}

      {/* 9. Download bar */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Export:</span>
        <DownloadButton label="Download segment membership file. CSV" onClick={handleDownloadSegmentCSV} />
        {hasMembership && <DownloadButton label="Membership CSV" onClick={handleDownloadMembershipCSV} />}
      </div>

      {/* ── Fullscreen Overlays ─────────────────────────────────────────────── */}
      {fullscreen === "pca" && hasPca && (
        <FullscreenOverlay
          title="Segment Contour Plot (PC1 × PC2)"
          onClose={() => setFullscreen(null)}
          actions={pcaDownloadActions}
        >
          <PcaScatterChart
            points={pcaPoints!}
            pc1Label={segData.pc1Label}
            pc2Label={segData.pc2Label}
            pc1Variance={segData.pc1Variance}
            pc2Variance={segData.pc2Variance}
            pc1TopFeatures={segData.pc1TopFeatures}
            pc2TopFeatures={segData.pc2TopFeatures}
            segmentNames={segmentNames}
            height={Math.max(500, (typeof window !== "undefined" ? window.innerHeight : 700) - 160)}
          />
        </FullscreenOverlay>
      )}

      {fullscreen === "snake" && hasZScores && (
        <FullscreenOverlay
          title="Z-Score Snake Plot"
          onClose={() => setFullscreen(null)}
          actions={snakeDownloadActions}
        >
          <ZSnakePlot
            segments={segments}
            height={Math.max(500, (typeof window !== "undefined" ? window.innerHeight : 700) - 160)}
          />
        </FullscreenOverlay>
      )}

      {fullscreen === "heatmap" && hasZScores && (
        <FullscreenOverlay
          title="Z-Score Heatmap"
          onClose={() => setFullscreen(null)}
          actions={heatmapDownloadActions}
        >
          <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 180px)" }}>
            <ZScoreHeatmap segments={segments} />
          </div>
        </FullscreenOverlay>
      )}

      {fullscreen === "table" && hasMembership && (
        <FullscreenOverlay
          title={`Segment Membership (${membershipTable!.length.toLocaleString()} records)`}
          onClose={() => setFullscreen(null)}
          actions={<DownloadButton label="CSV" onClick={handleDownloadMembershipCSV} />}
        >
          <MembershipTable
            members={membershipTable!}
            segmentNames={segmentNames}
            onDownloadCSV={handleDownloadMembershipCSV}
            onFullscreen={() => {}}
          />
        </FullscreenOverlay>
      )}
    </div>
  );
}
