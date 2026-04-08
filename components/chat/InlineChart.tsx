"use client";

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { Download, Maximize2, FileSpreadsheet, Presentation } from "lucide-react";
import { ChartData } from "@/lib/types";
import DownloadDialog from "@/components/ui/DownloadDialog";
import FullscreenOverlay from "@/components/ui/FullscreenOverlay";

const COLORS = ["#2891DA", "#34c98b", "#FFA550", "#DC2626"];
const PPTX_COLORS = ["2891DA", "34c98b", "FFA550", "DC2626"];

interface ChartBodyProps {
  data: ChartData[];
  height?: number;
}

function ChartBody({ data, height = 148 }: ChartBodyProps) {
  const showLabels = data.length <= 6;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barSize={32} margin={{ top: showLabels ? 20 : 4, right: 8, bottom: 0, left: showLabels ? -20 : 0 }}>
        <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
        {!showLabels && (
          <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} width={40} />
        )}
        <Tooltip
          contentStyle={{ background: "#ffffff", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px" }}
          formatter={(v) => [`${Number(v).toFixed(1)}%`, "Share"]}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          {showLabels && (
            <LabelList
              dataKey="value"
              position="top"
              formatter={(v) => (v != null ? `${Number(v).toFixed(1)}%` : "")}
              style={{ fill: "var(--text-primary)", fontSize: 11, fontWeight: 600 }}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function InlineChart({ data }: { data: ChartData[] }) {
  const [showPptxDialog, setShowPptxDialog] = useState(false);
  const [showCsvDialog, setShowCsvDialog] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

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

    slide.addText("Market Share by Region", {
      x: 0.5, y: 0.25, w: 9, h: 0.5,
      fontSize: 20, bold: true, color: "111111",
    });

    // Plot actual bar chart using pptxgenjs addChart
    const chartData = [
      {
        name: "Market Share",
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
          <span className="flex-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>Market Share by Region</span>
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
        <FullscreenOverlay title="Market Share by Region" onClose={() => setFullscreen(false)}>
          <ChartBody data={data} height={420} />
        </FullscreenOverlay>
      )}
    </>
  );
}
