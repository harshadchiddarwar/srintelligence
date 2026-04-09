"use client";

import { useState } from "react";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, LabelList, CartesianGrid,
} from "recharts";
import { Maximize2, FileSpreadsheet, Presentation } from "lucide-react";
import { ChartData } from "@/lib/types";
import DownloadDialog from "@/components/ui/DownloadDialog";
import FullscreenOverlay from "@/components/ui/FullscreenOverlay";

const COLORS = ["#2891DA", "#34c98b", "#FFA550", "#DC2626"];
const PPTX_COLORS = ["2891DA", "34c98b", "FFA550", "DC2626"];

/** Detect time-series data by looking for date/period-like name patterns. */
function isTimeSeries(data: ChartData[]): boolean {
  if (data.length <= 3) return false;
  return data.some((d) =>
    /\d{4}|\d{2}\/\d{2}\/\d{2,4}|\bjan\b|\bfeb\b|\bmar\b|\bapr\b|\bmay\b|\bjun\b|\bjul\b|\baug\b|\bsep\b|\boct\b|\bnov\b|\bdec\b|\bq[1-4]\b/i.test(d.name),
  );
}

/** Compact numeric formatter (1,234,567 → 1.2M, 12345 → 12.3K). */
function fmtValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

interface ChartBodyProps {
  data: ChartData[];
  height?: number;
}

function ChartBody({ data, height = 200 }: ChartBodyProps) {
  const timeSeries = isTimeSeries(data);

  if (timeSeries) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="name"
            tick={{ fill: "var(--text-muted)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "var(--text-muted)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={fmtValue}
            width={52}
          />
          <Tooltip
            contentStyle={{ background: "#ffffff", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px" }}
            formatter={(v: unknown) => [fmtValue(Number(v))]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#2891DA"
            strokeWidth={2}
            dot={data.length <= 30}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  const showLabels = data.length <= 6;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barSize={32} margin={{ top: showLabels ? 20 : 4, right: 8, bottom: 0, left: 8 }}>
        <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        {!showLabels && (
          <YAxis
            tick={{ fill: "var(--text-muted)", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={fmtValue}
            width={52}
          />
        )}
        <Tooltip
          contentStyle={{ background: "#ffffff", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px" }}
          formatter={(v: unknown) => [fmtValue(Number(v))]}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          {showLabels && (
            <LabelList
              dataKey="value"
              position="top"
              formatter={(v: unknown) => (v != null ? fmtValue(Number(v)) : "")}
              style={{ fill: "var(--text-primary)", fontSize: 11, fontWeight: 600 }}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function InlineChart({ data, title }: { data: ChartData[]; title?: string }) {
  const [showPptxDialog, setShowPptxDialog] = useState(false);
  const [showCsvDialog, setShowCsvDialog] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const chartTitle = title ?? (isTimeSeries(data) ? "Trend Over Time" : "Data Visualization");

  const downloadCSV = (filename: string) => {
    const header = "Category,Value";
    const rows = data.map((d) => `"${d.name}",${d.value}`).join("\n");
    const blob = new Blob([`${header}\n${rows}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPPTX = async (filename: string) => {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    const slide = pptx.addSlide();

    slide.addText(chartTitle, {
      x: 0.5, y: 0.25, w: 9, h: 0.5,
      fontSize: 20, bold: true, color: "111111",
    });

    const chartData = [
      {
        name: "Values",
        labels: data.map((d) => d.name),
        values: data.map((d) => d.value),
      },
    ];

    slide.addChart(pptx.ChartType.bar, chartData, {
      x: 0.5, y: 0.9, w: 9, h: 4.5,
      barGrouping: "clustered",
      chartColors: data.map((_, i) => PPTX_COLORS[i % PPTX_COLORS.length]),
      showValue: true,
      dataLabelFontSize: 11,
      dataLabelColor: "111111",
      dataLabelPosition: "outEnd",
      catAxisLabelColor: "3D3D3D",
      valAxisLabelColor: "3D3D3D",
      valAxisLabelFontSize: 10,
      catAxisLabelFontSize: 11,
      showLegend: false,
      showTitle: false,
    } as Parameters<typeof slide.addChart>[2]);

    await pptx.writeFile({ fileName: `${filename}.pptx` });
  };

  return (
    <>
      <div className="rounded-lg px-4 pt-3 pb-4" style={{ background: "#ffffff", border: "1px solid var(--border)" }}>
        {/* Toolbar */}
        <div className="flex items-center gap-1 mb-1">
          <span className="flex-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>{chartTitle}</span>
          <button onClick={() => setShowCsvDialog(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-black/5"
            style={{ color: "var(--text-muted)" }} title="Download chart data as CSV">
            <FileSpreadsheet size={12} />CSV
          </button>
          <button onClick={() => setShowPptxDialog(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-black/5"
            style={{ color: "var(--text-muted)" }} title="Download chart as PowerPoint slide">
            <Presentation size={12} />PPTX
          </button>
          <button onClick={() => setFullscreen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors hover:bg-black/5"
            style={{ color: "var(--text-muted)" }} title="Expand fullscreen">
            <Maximize2 size={12} />
          </button>
        </div>
        <ChartBody data={data} />
      </div>

      {showCsvDialog && (
        <DownloadDialog defaultName="chart-data" extension="csv" onConfirm={downloadCSV} onClose={() => setShowCsvDialog(false)} />
      )}
      {showPptxDialog && (
        <DownloadDialog defaultName="chart-slide" extension="pptx" onConfirm={downloadPPTX} onClose={() => setShowPptxDialog(false)} />
      )}
      {fullscreen && (
        <FullscreenOverlay title={chartTitle} onClose={() => setFullscreen(false)}>
          <ChartBody data={data} height={420} />
        </FullscreenOverlay>
      )}
    </>
  );
}
