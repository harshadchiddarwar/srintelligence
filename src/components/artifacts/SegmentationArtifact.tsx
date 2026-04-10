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
// Unique painting-inspired SVG portrait avatars (8, no repeats)
// ---------------------------------------------------------------------------

function PaintingAvatar({ index, palette }: { index: number; palette: typeof PALETTES[0] }) {
  const id = `pa-${index}`;
  // 8 unique painting-style portrait miniatures
  const portraits: React.ReactNode[] = [

    // 0 — The Scholar: candlelit study, side profile, quill pen
    <svg key="p0" width="48" height="56" viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`${id}-clip`}><ellipse cx="24" cy="26" rx="21" ry="24" /></clipPath>
        <radialGradient id={`${id}-bg`} cx="35%" cy="30%"><stop offset="0%" stopColor="#f8e9c8"/><stop offset="100%" stopColor={palette.accent} stopOpacity="0.55"/></radialGradient>
      </defs>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>
        {/* warm background wash */}
        <rect x="0" y="0" width="48" height="56" fill={palette.bg} opacity="0.6"/>
        <ellipse cx="32" cy="14" rx="18" ry="14" fill={palette.accent} opacity="0.12"/>
        {/* shoulder / torso — dark academic coat */}
        <path d="M6 56 Q10 38 24 35 Q38 38 42 56Z" fill="#2a1f14"/>
        {/* white cravat/collar */}
        <path d="M18 37 Q24 34 30 37 L28 40 Q24 38 20 40Z" fill="#f0ece0"/>
        {/* head — three-quarter left-facing */}
        <ellipse cx="22" cy="24" rx="10" ry="12" fill="#e8c9a0"/>
        {/* hair — swept back, dark */}
        <path d="M12 20 Q13 10 22 10 Q31 11 32 18 Q29 12 22 13 Q15 13 12 20Z" fill="#2c1a0e"/>
        <path d="M30 18 Q34 16 33 22" stroke="#2c1a0e" strokeWidth="2.5" fill="none"/>
        {/* face shading — painterly */}
        <ellipse cx="20" cy="24" rx="4" ry="5" fill="#d4a87a" opacity="0.3"/>
        {/* suggestion of features — minimal, painterly */}
        <path d="M17 22 Q19 21 21 22" stroke="#8b5e3c" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M23 22 Q25 21 27 22" stroke="#8b5e3c" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M19 27 Q22 29 25 27" stroke="#8b5e3c" strokeWidth="1.1" fill="none" opacity="0.8"/>
        {/* quill pen */}
        <path d="M30 20 L38 8" stroke="#d4c090" strokeWidth="1.2"/>
        <path d="M38 8 Q40 6 38 10 Q36 13 34 16Z" fill="#d4c090" opacity="0.8"/>
      </g>
      {/* oval portrait frame */}
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.accent} strokeWidth="2" opacity="0.7"/>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.border} strokeWidth="4" opacity="0.5" strokeDasharray="2 3"/>
    </svg>,

    // 1 — The Noble: rich velvet, front-facing, ornate collar
    <svg key="p1" width="48" height="56" viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`${id}-clip`}><ellipse cx="24" cy="26" rx="21" ry="24" /></clipPath>
        <radialGradient id={`${id}-bg`} cx="50%" cy="25%"><stop offset="0%" stopColor="#e8d8f5"/><stop offset="100%" stopColor={palette.accent} stopOpacity="0.6"/></radialGradient>
      </defs>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <rect x="0" y="0" width="48" height="56" fill={palette.bg} opacity="0.5"/>
        {/* deep velvet background */}
        <rect x="0" y="0" width="48" height="56" fill={palette.accent} opacity="0.08"/>
        {/* ornate ruff collar */}
        <path d="M8 42 Q16 34 24 33 Q32 34 40 42 L40 56 L8 56Z" fill="#f5f0e8"/>
        <path d="M12 40 Q18 36 24 35 Q30 36 36 40" stroke="#d4c090" strokeWidth="1" fill="none" opacity="0.8"/>
        <path d="M10 43 Q17 37 24 36 Q31 37 38 43" stroke="#d4c090" strokeWidth="0.7" fill="none" opacity="0.6"/>
        {/* shoulders — dark velvet */}
        <path d="M4 56 L6 40 Q14 34 24 33 Q34 34 42 40 L44 56Z" fill="#1e0d2e"/>
        {/* head */}
        <ellipse cx="24" cy="23" rx="11" ry="12.5" fill="#e2b990"/>
        {/* hair — elaborate updo */}
        <path d="M13 19 Q14 8 24 7 Q34 8 35 19 Q32 10 24 10 Q16 10 13 19Z" fill="#0d0d0d"/>
        <ellipse cx="24" cy="8" rx="5" ry="3" fill="#1a1a1a"/>
        <path d="M13 14 Q11 12 12 17" stroke="#0d0d0d" strokeWidth="3" fill="none"/>
        <path d="M35 14 Q37 12 36 17" stroke="#0d0d0d" strokeWidth="3" fill="none"/>
        {/* face shading */}
        <ellipse cx="24" cy="24" rx="5" ry="6" fill="#c9956e" opacity="0.25"/>
        {/* features */}
        <path d="M19 21 Q21 20 23 21" stroke="#7a4a2a" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M25 21 Q27 20 29 21" stroke="#7a4a2a" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M21 27 Q24 29.5 27 27" stroke="#7a4a2a" strokeWidth="1.1" fill="none" opacity="0.8"/>
        {/* jewel brooch */}
        <circle cx="24" cy="37" r="2.5" fill={palette.accent} opacity="0.9"/>
        <circle cx="24" cy="37" r="1.2" fill="#fff" opacity="0.7"/>
      </g>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.accent} strokeWidth="2" opacity="0.7"/>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.border} strokeWidth="4" opacity="0.5" strokeDasharray="2 3"/>
    </svg>,

    // 2 — The Impressionist: dappled outdoor light, flowing hat
    <svg key="p2" width="48" height="56" viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`${id}-clip`}><ellipse cx="24" cy="26" rx="21" ry="24" /></clipPath>
        <radialGradient id={`${id}-bg`} cx="40%" cy="20%"><stop offset="0%" stopColor="#d4f0d8"/><stop offset="60%" stopColor={palette.accent} stopOpacity="0.3"/><stop offset="100%" stopColor="#a8d8b0" stopOpacity="0.8"/></radialGradient>
      </defs>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <rect x="0" y="0" width="48" height="56" fill={palette.bg} opacity="0.45"/>
        {/* impressionist dappled light spots */}
        <circle cx="8" cy="10" r="6" fill={palette.accent} opacity="0.08"/>
        <circle cx="38" cy="8" r="8" fill="#fff" opacity="0.15"/>
        <circle cx="42" cy="30" r="5" fill={palette.accent} opacity="0.1"/>
        {/* soft torso */}
        <path d="M4 56 Q10 40 24 37 Q38 40 44 56Z" fill={palette.accent} opacity="0.6"/>
        {/* light blouse */}
        <path d="M16 40 Q20 37 24 37 Q28 37 32 40 L30 44 Q24 42 18 44Z" fill="#f0f0ea" opacity="0.9"/>
        {/* head */}
        <ellipse cx="24" cy="25" rx="10" ry="11" fill="#f0d0a8"/>
        {/* wide-brimmed summer hat */}
        <ellipse cx="24" cy="15" rx="16" ry="5" fill={palette.accent} opacity="0.85"/>
        <path d="M12 15 Q16 9 24 8 Q32 9 36 15" fill={palette.accent} opacity="0.9"/>
        {/* hat ribbon */}
        <path d="M12 15 Q24 13 36 15" stroke={palette.border} strokeWidth="2" fill="none" opacity="0.8"/>
        {/* face — loose impressionist strokes */}
        <ellipse cx="22" cy="26" rx="3" ry="4" fill="#d4a070" opacity="0.2"/>
        <path d="M19 23 Q21 22 23 23" stroke="#8b5e3c" strokeWidth="0.9" fill="none" opacity="0.65"/>
        <path d="M24.5 23 Q26.5 22 28.5 23" stroke="#8b5e3c" strokeWidth="0.9" fill="none" opacity="0.65"/>
        <path d="M20 29 Q24 31 28 29" stroke="#8b5e3c" strokeWidth="1.1" fill="none" opacity="0.75"/>
        {/* loose flowing hair strands */}
        <path d="M14 22 Q12 30 14 36" stroke="#5c3a1e" strokeWidth="1.5" fill="none" opacity="0.5"/>
        <path d="M34 22 Q36 28 34 34" stroke="#5c3a1e" strokeWidth="1.5" fill="none" opacity="0.5"/>
      </g>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.accent} strokeWidth="2" opacity="0.7"/>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.border} strokeWidth="4" opacity="0.5" strokeDasharray="2 3"/>
    </svg>,

    // 3 — The Merchant: Baroque confidence, rich coat, looking right
    <svg key="p3" width="48" height="56" viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`${id}-clip`}><ellipse cx="24" cy="26" rx="21" ry="24" /></clipPath>
        <radialGradient id={`${id}-bg`} cx="60%" cy="35%"><stop offset="0%" stopColor="#fde8c0"/><stop offset="100%" stopColor={palette.accent} stopOpacity="0.5"/></radialGradient>
      </defs>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <rect x="0" y="0" width="48" height="56" fill={palette.bg} opacity="0.5"/>
        <ellipse cx="10" cy="45" rx="15" ry="20" fill={palette.accent} opacity="0.07"/>
        {/* opulent coat */}
        <path d="M4 56 L8 36 Q16 28 26 27 Q36 28 42 36 L44 56Z" fill="#3a1f08"/>
        {/* gold trim */}
        <path d="M18 38 Q24 35 30 38" stroke="#c8a850" strokeWidth="1.5" fill="none"/>
        <path d="M16 42 Q24 39 32 42" stroke="#c8a850" strokeWidth="1" fill="none" opacity="0.7"/>
        {/* white jabot */}
        <path d="M20 36 Q24 33 28 36 Q26 40 24 38 Q22 40 20 36Z" fill="#f5f0e8"/>
        {/* head — turned slightly right */}
        <ellipse cx="25" cy="23" rx="10" ry="11.5" fill="#d4a070"/>
        {/* short curled wig */}
        <path d="M15 20 Q15 9 25 8 Q35 9 35 20 Q33 11 25 11 Q17 11 15 20Z" fill="#d4c8b0"/>
        <path d="M15 16 Q12 18 13 22" stroke="#d4c8b0" strokeWidth="3" fill="none"/>
        <path d="M35 16 Q38 18 37 22" stroke="#d4c8b0" strokeWidth="3" fill="none"/>
        {/* curls at sides */}
        <path d="M13 20 Q10 24 13 28" stroke="#c0b090" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M37 20 Q40 24 37 28" stroke="#c0b090" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        {/* face shadow + features */}
        <ellipse cx="26" cy="24" rx="4" ry="5" fill="#b07840" opacity="0.2"/>
        <path d="M21 21 Q23 20 25 21" stroke="#6b3a1a" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M27 21 Q29 20 31 21" stroke="#6b3a1a" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M22 27 Q25 29 28 27" stroke="#6b3a1a" strokeWidth="1.1" fill="none" opacity="0.75"/>
        {/* pocket watch chain */}
        <path d="M28 38 Q32 36 34 32" stroke="#c8a850" strokeWidth="0.8" fill="none" opacity="0.7"/>
      </g>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.accent} strokeWidth="2" opacity="0.7"/>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.border} strokeWidth="4" opacity="0.5" strokeDasharray="2 3"/>
    </svg>,

    // 4 — The Romantic: Pre-Raphaelite, flowing auburn hair, soft gaze left
    <svg key="p4" width="48" height="56" viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`${id}-clip`}><ellipse cx="24" cy="26" rx="21" ry="24" /></clipPath>
        <radialGradient id={`${id}-bg`} cx="50%" cy="30%"><stop offset="0%" stopColor="#fce8f0"/><stop offset="100%" stopColor={palette.accent} stopOpacity="0.45"/></radialGradient>
      </defs>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <rect x="0" y="0" width="48" height="56" fill={palette.bg} opacity="0.45"/>
        <ellipse cx="36" cy="10" rx="14" ry="10" fill="#fff" opacity="0.2"/>
        {/* soft draped garment */}
        <path d="M4 56 Q10 38 24 34 Q38 38 44 56Z" fill={palette.accent} opacity="0.35"/>
        <path d="M14 56 Q16 40 24 37 Q32 40 34 56Z" fill="#f0e8f4" opacity="0.7"/>
        {/* head — gentle oval, slightly left */}
        <ellipse cx="23" cy="24" rx="10" ry="12" fill="#f2d4b0"/>
        {/* abundant flowing auburn hair */}
        <path d="M13 22 Q11 14 16 10 Q20 7 24 8 Q28 7 32 10 Q37 14 35 22 Q33 12 24 12 Q15 12 13 22Z" fill="#8b3a14"/>
        {/* flowing sides */}
        <path d="M13 20 Q8 28 9 40 Q12 50 14 56" stroke="#8b3a14" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.8"/>
        <path d="M35 20 Q40 30 39 42 Q37 50 35 56" stroke="#8b3a14" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7"/>
        {/* highlight strands */}
        <path d="M14 18 Q10 26 11 36" stroke="#c06030" strokeWidth="1.5" fill="none" opacity="0.5"/>
        {/* face — Pre-Raphaelite softness */}
        <ellipse cx="22" cy="25" rx="4" ry="5" fill="#e0a878" opacity="0.2"/>
        <path d="M18 22 Q20.5 21 23 22" stroke="#7a4030" strokeWidth="0.9" fill="none" opacity="0.65"/>
        <path d="M24.5 22 Q26.5 21 28.5 22" stroke="#7a4030" strokeWidth="0.9" fill="none" opacity="0.65"/>
        <path d="M19.5 28 Q23 30.5 26.5 28" stroke="#7a4030" strokeWidth="1.1" fill="none" opacity="0.8"/>
        {/* floral accent in hair */}
        <circle cx="14" cy="16" r="2.5" fill={palette.accent} opacity="0.75"/>
        <circle cx="14" cy="16" r="1.2" fill="#fff" opacity="0.6"/>
      </g>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.accent} strokeWidth="2" opacity="0.7"/>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.border} strokeWidth="4" opacity="0.5" strokeDasharray="2 3"/>
    </svg>,

    // 5 — The Naturalist: cool field scientist, neat coat, specimen in hand
    <svg key="p5" width="48" height="56" viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`${id}-clip`}><ellipse cx="24" cy="26" rx="21" ry="24" /></clipPath>
        <radialGradient id={`${id}-bg`} cx="30%" cy="25%"><stop offset="0%" stopColor="#d0f0f8"/><stop offset="100%" stopColor={palette.accent} stopOpacity="0.5"/></radialGradient>
      </defs>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <rect x="0" y="0" width="48" height="56" fill={palette.bg} opacity="0.5"/>
        <ellipse cx="38" cy="12" rx="12" ry="10" fill={palette.accent} opacity="0.1"/>
        {/* neat field coat */}
        <path d="M4 56 L9 36 Q16 28 24 27 Q32 28 39 36 L44 56Z" fill="#1c3a4a"/>
        {/* light shirt collar */}
        <path d="M19 34 Q24 31 29 34 L27 37 Q24 35.5 21 37Z" fill="#eef4f8"/>
        {/* lapels */}
        <path d="M19 34 Q15 38 14 44" stroke="#152d3a" strokeWidth="2" fill="none"/>
        <path d="M29 34 Q33 38 34 44" stroke="#152d3a" strokeWidth="2" fill="none"/>
        {/* head */}
        <ellipse cx="24" cy="23" rx="10" ry="11.5" fill="#e0c090"/>
        {/* neat short dark hair */}
        <path d="M14 20 Q14 9 24 8 Q34 9 34 20 Q32 11 24 11 Q16 11 14 20Z" fill="#1a1a2e"/>
        <path d="M14 18 Q13 14 14 20" stroke="#1a1a2e" strokeWidth="2" fill="none"/>
        {/* clean side parting */}
        <path d="M20 9 Q21 11 20 14" stroke="#2a2a3e" strokeWidth="1" fill="none" opacity="0.5"/>
        {/* face */}
        <ellipse cx="24" cy="24" rx="3.5" ry="4.5" fill="#c89858" opacity="0.2"/>
        <path d="M19.5 21 Q21.5 20 23.5 21" stroke="#5a3a18" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M24.5 21 Q26.5 20 28.5 21" stroke="#5a3a18" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M20.5 27.5 Q24 30 27.5 27.5" stroke="#5a3a18" strokeWidth="1.1" fill="none" opacity="0.75"/>
        {/* specimen vial / magnifier */}
        <rect x="31" y="28" width="4" height="9" rx="2" fill={palette.accent} opacity="0.6"/>
        <rect x="31" y="28" width="4" height="3" rx="1.5" fill="#fff" opacity="0.5"/>
        <line x1="33" y1="37" x2="33" y2="41" stroke={palette.accent} strokeWidth="1.2" opacity="0.6"/>
      </g>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.accent} strokeWidth="2" opacity="0.7"/>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.border} strokeWidth="4" opacity="0.5" strokeDasharray="2 3"/>
    </svg>,

    // 6 — The Captain: warm golden, facing right, epaulettes
    <svg key="p6" width="48" height="56" viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`${id}-clip`}><ellipse cx="24" cy="26" rx="21" ry="24" /></clipPath>
        <radialGradient id={`${id}-bg`} cx="45%" cy="25%"><stop offset="0%" stopColor="#fef5c8"/><stop offset="100%" stopColor={palette.accent} stopOpacity="0.5"/></radialGradient>
      </defs>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <rect x="0" y="0" width="48" height="56" fill={palette.bg} opacity="0.45"/>
        <ellipse cx="40" cy="40" rx="16" ry="16" fill={palette.accent} opacity="0.08"/>
        {/* naval coat */}
        <path d="M4 56 L7 35 Q14 27 24 26 Q34 27 41 35 L44 56Z" fill="#1a2a4a"/>
        {/* gold epaulettes */}
        <path d="M7 36 Q12 31 16 33 Q12 35 10 38Z" fill="#c8a030" opacity="0.9"/>
        <path d="M41 36 Q36 31 32 33 Q36 35 38 38Z" fill="#c8a030" opacity="0.9"/>
        {/* white stock */}
        <path d="M19 33 Q24 30 29 33 L27.5 36 Q24 34.5 20.5 36Z" fill="#f5f0e8"/>
        {/* decorative buttons */}
        <circle cx="24" cy="39" r="1.5" fill="#c8a030" opacity="0.8"/>
        <circle cx="24" cy="43.5" r="1.5" fill="#c8a030" opacity="0.8"/>
        {/* head — right-facing, strong jaw */}
        <ellipse cx="25" cy="23" rx="10" ry="11" fill="#d4a060"/>
        {/* peaked officer cap */}
        <ellipse cx="25" cy="13" rx="13" ry="4" fill="#1a2a4a"/>
        <rect x="14" y="9" width="22" height="7" rx="3" fill="#1a2a4a"/>
        {/* cap badge */}
        <path d="M22 10 L24 7 L26 10" fill="#c8a030" opacity="0.9"/>
        {/* face */}
        <ellipse cx="26" cy="24" rx="4" ry="5" fill="#b07030" opacity="0.2"/>
        <path d="M21 21 Q23.5 20 25.5 21" stroke="#6b3a10" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M27 21 Q29 20 31 21" stroke="#6b3a10" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M22 27.5 Q25.5 30 29 27.5" stroke="#6b3a10" strokeWidth="1.1" fill="none" opacity="0.75"/>
      </g>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.accent} strokeWidth="2" opacity="0.7"/>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.border} strokeWidth="4" opacity="0.5" strokeDasharray="2 3"/>
    </svg>,

    // 7 — The Composer: dramatic lighting, waistcoat, slightly elevated gaze
    <svg key="p7" width="48" height="56" viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={`${id}-clip`}><ellipse cx="24" cy="26" rx="21" ry="24" /></clipPath>
        <radialGradient id={`${id}-bg`} cx="50%" cy="60%"><stop offset="0%" stopColor="#ffd8e0"/><stop offset="100%" stopColor={palette.accent} stopOpacity="0.55"/></radialGradient>
      </defs>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <rect x="0" y="0" width="48" height="56" fill={palette.bg} opacity="0.45"/>
        {/* dramatic dark background upper */}
        <rect x="0" y="0" width="48" height="25" fill="#1a0810" opacity="0.3"/>
        {/* frock coat */}
        <path d="M4 56 L8 33 Q15 25 24 24 Q33 25 40 33 L44 56Z" fill="#2a1020"/>
        {/* waistcoat */}
        <path d="M17 34 Q24 31 31 34 Q29 42 24 44 Q19 42 17 34Z" fill={palette.accent} opacity="0.6"/>
        {/* cravat */}
        <path d="M20 34 Q24 31.5 28 34 L26 37 Q24 36 22 37Z" fill="#f5f0e8"/>
        {/* head — slightly upward gaze, expressive */}
        <ellipse cx="24" cy="22" rx="10.5" ry="12" fill="#e8c090"/>
        {/* wild romantic hair */}
        <path d="M13 18 Q13 7 24 6 Q35 7 35 18 Q33 8 24 8 Q15 8 13 18Z" fill="#1a0a0a"/>
        <path d="M13 14 Q10 16 11 22" stroke="#1a0a0a" strokeWidth="3.5" fill="none"/>
        <path d="M35 14 Q38 16 37 22" stroke="#1a0a0a" strokeWidth="3.5" fill="none"/>
        {/* dishevelled locks */}
        <path d="M13 16 Q11 22 12 28" stroke="#2a1010" strokeWidth="2" fill="none" opacity="0.6"/>
        <path d="M17 8 Q15 12 16 16" stroke="#2a1010" strokeWidth="1.5" fill="none" opacity="0.5"/>
        {/* face — dramatic lighting from below */}
        <ellipse cx="24" cy="23" rx="4.5" ry="5.5" fill="#d4a060" opacity="0.15"/>
        <ellipse cx="24" cy="26" rx="5" ry="3" fill="#fff" opacity="0.08"/>
        <path d="M19 20 Q21.5 19 24 20" stroke="#6a3818" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M24 20 Q26.5 19 29 20" stroke="#6a3818" strokeWidth="0.9" fill="none" opacity="0.7"/>
        <path d="M20 26.5 Q24 29 28 26.5" stroke="#6a3818" strokeWidth="1.2" fill="none" opacity="0.75"/>
        {/* musical note motif */}
        <text x="36" y="22" fontSize="9" fill={palette.accent} opacity="0.6" fontFamily="serif">♪</text>
      </g>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.accent} strokeWidth="2" opacity="0.7"/>
      <ellipse cx="24" cy="26" rx="21" ry="24" fill="none" stroke={palette.border} strokeWidth="4" opacity="0.5" strokeDasharray="2 3"/>
    </svg>,
  ];

  return (
    <div className="shrink-0" style={{ width: 48, height: 56 }}>
      {portraits[index % portraits.length]}
    </div>
  );
}

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
function computeSegmentPca(segments: SegmentProfile[]): PcaPoint[] {
  const features = Array.from(
    new Set(segments.flatMap((s) => Object.keys(s.zScores ?? {})))
  );
  if (features.length < 2 || segments.length < 2) return [];

  // Build matrix: N segments × P features
  const M: number[][] = segments.map((s) =>
    features.map((f) => (s.zScores ?? {})[f] ?? 0)
  );
  const N = M.length;
  const P = features.length;

  // Column-center (z-scores are already roughly centered, but normalise anyway)
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

  /** Power iteration — returns the dominant unit eigenvector of `mat`. */
  function powerIter(mat: number[][]): number[] {
    // deterministic seed: start with [1, 0, 0, ...]
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

  const pc1 = powerIter(cov);

  // Deflate: cov2 = cov - λ1 · pc1 · pc1ᵀ
  // eigenvalue λ1 = pc1ᵀ · cov · pc1
  const lambda1 = pc1.reduce(
    (s, _, i) => s + pc1[i] * cov[i].reduce((ss, x, j) => ss + x * pc1[j], 0),
    0
  );
  const cov2: number[][] = cov.map((row, i) =>
    row.map((val, j) => val - lambda1 * pc1[i] * pc1[j])
  );
  const pc2 = powerIter(cov2);

  // Project each segment centroid
  return segments.map((seg, k) => ({
    pc1: C[k].reduce((s, v, j) => s + v * pc1[j], 0),
    pc2: C[k].reduce((s, v, j) => s + v * pc2[j], 0),
    cluster: seg.id,
    pct: seg.pct > 0 ? seg.pct : undefined,
  }));
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
    // The line may be: "**Short-Term Prescribers (34.26%):** Description..."
    // or just: "Short-Term Prescribers"
    let rawLine = m[2].trim().replace(/^\*\*+/, "").trim();

    // Split on ":**" (bold colon) or ": " (plain colon)
    const boldColonIdx = rawLine.indexOf(":**");
    const plainColonIdx = rawLine.indexOf(": ");
    const splitIdx = boldColonIdx >= 0 ? boldColonIdx : plainColonIdx >= 0 ? plainColonIdx : -1;

    let shortName = splitIdx > 0 ? rawLine.slice(0, splitIdx).replace(/\*+/g, "").trim() : rawLine.replace(/\*+/g, "").trim();
    const descFromLine = splitIdx > 0 ? rawLine.slice(splitIdx + (boldColonIdx >= 0 ? 3 : 2)).trim() : "";

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
  const pcaPoints = computeSegmentPca(segments);
  if (pcaPoints.length > 0) {
    result.pcaPoints = pcaPoints;
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
      name: ((seg["label"] as string) ?? (seg["name"] as string) ?? `Segment ${i + 1}`).replace(/^\s*[—–\-]\s*/, "").trim(),
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
        <PaintingAvatar index={index} palette={pal} />
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
  segmentNames: Record<number, string>;
  height?: number;
}

function PcaScatterChart({ points, pc1Label, pc2Label, pc1Variance, pc2Variance, segmentNames, height = 340 }: PcaScatterProps) {
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

  // Axis labels: include variance % interpretation if available
  const xLabel = pc1Variance != null
    ? `${pc1Label ?? "PC1"} — Primary Differentiation Axis (${pc1Variance.toFixed(1)}% of variance explained)`
    : `${pc1Label ?? "PC1"} — Primary Differentiation Axis`;
  const yLabel = pc2Variance != null
    ? `${pc2Label ?? "PC2"} — Secondary Differentiation Axis (${pc2Variance.toFixed(1)}% explained)`
    : `${pc2Label ?? "PC2"} — Secondary Differentiation Axis`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      {/* Extra bottom margin so legend doesn't collide with X-axis label */}
      <ScatterChart margin={{ top: 20, right: 50, bottom: 55, left: 65 }}>
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
          label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 15, fontSize: 10, fill: "#888", dy: -10 }}
          width={60}
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

/** Convert a z-score to a CSS rgb() colour: red = below average, green = above average. */
function zToHeatColor(z: number, maxAbs: number): string {
  const t = Math.max(-1, Math.min(1, z / Math.max(maxAbs, 0.01)));
  if (t < 0) {
    // below average → red shades (white → red)
    const intensity = Math.abs(t);
    const r = 255;
    const g = Math.round(255 - intensity * 178); // 255 → 77
    const b = Math.round(255 - intensity * 178);
    return `rgb(${r},${g},${b})`;
  } else {
    // above average → green shades (white → green)
    const intensity = t;
    const r = Math.round(255 - intensity * 178);
    const g = Math.round(200 + intensity * 35); // 200 → 235 (rich forest green)
    const b = Math.round(255 - intensity * 178);
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
            background: "linear-gradient(to right, rgb(255,77,77), #fff, rgb(77,235,77))",
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
          const pts = computeSegmentPca(segData.segments);
          if (pts.length > 0) {
            segData.pcaPoints = pts;
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
          {segData.pc1Variance != null && segData.pc2Variance != null && (
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              Together PC1 + PC2 capture {(segData.pc1Variance + segData.pc2Variance).toFixed(1)}% of the total variance
              across all segmentation features.
            </p>
          )}
          <div ref={pcaRef}>
            <PcaScatterChart
              points={pcaPoints!}
              pc1Label={segData.pc1Label}
              pc2Label={segData.pc2Label}
              pc1Variance={segData.pc1Variance}
              pc2Variance={segData.pc2Variance}
              segmentNames={segmentNames}
            />
          </div>
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
