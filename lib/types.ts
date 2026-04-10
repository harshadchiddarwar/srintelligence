export type NavSection = "chat" | "data-explore" | "workflows";

export interface RecentAnalysis {
  id: string;
  title: string;
  timestamp: string;
  threadId: string;
}

export interface ChatThread {
  id: string;
  title: string;
  date: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  agentActivity?: AgentActivity;
  tableData?: TableData;
  chartData?: ChartData[];
  suggestedFollowups?: string[];
  /** Structured forecast data — when set, renders ForecastArtifact instead of plain markdown */
  forecastData?: Record<string, unknown>;
  /** Structured segmentation data — when set, renders SegmentationArtifact instead of plain markdown */
  segmentData?: Record<string, unknown>;
  /** Raw narrative text from the clustering agent — preserved so the component can extract z-scores */
  clusterNarrative?: string;
}

export interface AgentActivity {
  masterAgent: string;
  routedTo: string;
  latency: string;
}

export interface TableData {
  headers: string[];
  rows: (string | number)[][];
}

export interface ChartData {
  name: string;
  value: number;
  change?: number;
}

export interface WorkflowCard {
  id: string;
  name: string;
  description: string;
  agentChain: AgentStep[];
  schedule: "manual" | "auto";
  scheduleLabel?: string;
  lastRun: string;
  status: "success" | "running" | "failed";
  runCount: number;
}

export interface AgentStep {
  id: string;
  type: AgentType;
  label: string;
  prompt?: string;
  icon: string;
  config?: Record<string, unknown>;
  runPerSegment?: boolean;
  position?: { x: number; y: number };
}

export type AgentType =
  | "sri-forecast"
  | "sri-clustering"
  | "sri-mtree"
  | "sri-causal"
  // forecast sub-types
  | "prophet"
  | "sarima"
  | "holt-winters"
  | "xgboost"
  | "hybrid"
  | "auto-forecast"
  // clustering sub-types
  | "gmm"
  | "kmeans"
  | "kmedoids"
  | "dbscan"
  | "hierarchical"
  | "auto-cluster"
  | "output";

export interface WorkflowRun {
  id: string;
  runNumber: number;
  workflowId: string;
  startedAt: string;
  steps: WorkflowRunStep[];
}

export interface WorkflowRunStep {
  stepId: string;
  label: string;
  icon: string;
  status: "done" | "running" | "pending" | "failed";
  duration?: string;
  progress?: number;
  result?: WorkflowStepResult;
}

export interface WorkflowStepResult {
  type: "table" | "segments" | "forecast";
  data: unknown;
}

export interface SemanticTable {
  id: string;
  name: string;
  icon: string;
  columns: SemanticColumn[];
  position: { x: number; y: number };
  relations: TableRelation[];
}

export interface SemanticColumn {
  name: string;
  type: string;
  description: string;
  samples: string;
}

export interface TableRelation {
  targetTable: string;
  joinKey: string;
  label: string;
}

export interface BusinessRule {
  name: string;
  definition: string;
  details: string[];
}

export interface SemanticModel {
  id: string;
  name: string;
  description: string;
  tables: SemanticTable[];
}
