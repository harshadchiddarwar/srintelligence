"use client";

import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Star, TrendingUp, AlertCircle } from "lucide-react";

interface AgentStat {
  agentName: string;
  totalRatings: number;
  averageRating: number;
  sqlCorrectionCount: number;
}

interface DashboardData {
  totalFeedback: number;
  averageRatingOverall: number;
  agentStats: AgentStat[];
}

export default function FeedbackDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/feedback/stats")
      .then((r) => r.json())
      .then((d) => { setData(d.dashboard ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-center p-6" style={{ color: "var(--text-muted)" }}>No feedback data available.</p>;
  }

  const rating = data.averageRatingOverall;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-1">
            <Star size={14} style={{ color: "#f59e0b" }} />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Avg Rating</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{rating.toFixed(1)}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>out of 5</p>
        </div>

        <div className="rounded-xl p-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} style={{ color: "var(--accent)" }} />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Total Feedback</span>
          </div>
          <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{data.totalFeedback}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>responses</p>
        </div>

        <div className="rounded-xl p-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-1">
            {rating >= 3.5 ? <ThumbsUp size={14} style={{ color: "var(--success)" }} /> : <ThumbsDown size={14} style={{ color: "#ef4444" }} />}
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Sentiment</span>
          </div>
          <p className="text-lg font-bold" style={{ color: rating >= 3.5 ? "var(--success)" : "#ef4444" }}>
            {rating >= 4 ? "Positive" : rating >= 3 ? "Neutral" : "Needs work"}
          </p>
        </div>
      </div>

      {/* Per-agent stats */}
      {data.agentStats.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>By Agent</h3>
          <div className="flex flex-col gap-2">
            {data.agentStats.map((stat) => (
              <div key={stat.agentName} className="flex items-center gap-3">
                <span className="text-xs w-32 truncate" style={{ color: "var(--text-secondary)" }}>{stat.agentName}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-tertiary)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(stat.averageRating / 5) * 100}%`, background: stat.averageRating >= 3.5 ? "var(--success)" : "#f59e0b" }}
                  />
                </div>
                <span className="text-xs w-6 text-right" style={{ color: "var(--text-muted)" }}>{stat.averageRating.toFixed(1)}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>({stat.totalRatings})</span>
                {stat.sqlCorrectionCount > 0 && (
                  <span className="flex items-center gap-0.5 text-xs" style={{ color: "#f59e0b" }}>
                    <AlertCircle size={10} />{stat.sqlCorrectionCount}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
