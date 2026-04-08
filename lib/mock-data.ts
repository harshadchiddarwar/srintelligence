import {
  RecentAnalysis,
  ChatThread,
  WorkflowCard,
  WorkflowRun,
  SemanticTable,
  SemanticModel,
  BusinessRule,
} from "./types";

export const recentAnalyses: RecentAnalysis[] = [
  { id: "1", title: "Brand1 market share by region", timestamp: "2 hours ago", threadId: "thread-1" },
  { id: "2", title: "Top 10 physicians by claim volume", timestamp: "yesterday", threadId: "thread-2" },
  { id: "3", title: "OOP distribution for commercial plans", timestamp: "Apr 3", threadId: "thread-3" },
  { id: "4", title: "Payer fill rate analysis — Humana", timestamp: "Apr 1", threadId: "thread-4" },
  { id: "5", title: "13-week Brand1 forecast", timestamp: "Mar 28", threadId: "thread-5" },
];

export const chatThreads: ChatThread[] = [
  {
    id: "thread-1",
    title: "Brand1 market share by region",
    date: "Apr 7",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "What's the market share for Brand1 by region?",
      },
      {
        id: "m2",
        role: "agent",
        content: "Here's the Brand1 market share breakdown by region:",
        agentActivity: {
          masterAgent: "Master Agent",
          routedTo: "Cortex Analyst",
          latency: "1.2s",
        },
        tableData: {
          headers: ["Region", "Claims", "Share", "Δ vs Prior"],
          rows: [
            ["North East", "124,531", "42.31%", "+1.20pp"],
            ["Midwest", "82,744", "28.12%", "-0.50pp"],
            ["South", "65,892", "22.40%", "+0.30pp"],
            ["West", "21,201", "7.21%", "-1.00pp"],
          ],
        },
        chartData: [
          { name: "North East", value: 42.31, change: 1.2 },
          { name: "Midwest", value: 28.12, change: -0.5 },
          { name: "South", value: 22.4, change: 0.3 },
          { name: "West", value: 7.21, change: -1.0 },
        ],
        suggestedFollowups: [
          "What's driving the decline in the West?",
          "Show top 5 plans in each region",
          "Forecast Brand1 claims for the next 13 weeks",
        ],
      },
    ],
  },
  {
    id: "thread-2",
    title: "Top 10 physicians by claim volume",
    date: "Apr 6",
    messages: [
      { id: "m3", role: "user", content: "Who are the top 10 physicians by claim volume?" },
      {
        id: "m4",
        role: "agent",
        content: "Here are the top 10 physicians by total dispensed claim volume:",
        agentActivity: {
          masterAgent: "Master Agent",
          routedTo: "Cortex Analyst",
          latency: "0.9s",
        },
        tableData: {
          headers: ["Physician", "NPI", "Specialty", "Claims", "Avg OOP"],
          rows: [
            ["Dr. Sarah Chen", "1234567890", "Oncology", "3,421", "$12.40"],
            ["Dr. Mark Torres", "2345678901", "Cardiology", "2,987", "$8.20"],
            ["Dr. Lisa Park", "3456789012", "Rheumatology", "2,654", "$15.80"],
            ["Dr. James Wu", "4567890123", "Neurology", "2,312", "$22.10"],
            ["Dr. Amy Johnson", "5678901234", "Oncology", "2,201", "$11.30"],
            ["Dr. Robert Kim", "6789012345", "Endocrinology", "1,988", "$9.70"],
            ["Dr. Maria Santos", "7890123456", "Hematology", "1,876", "$18.40"],
            ["Dr. David Lee", "8901234567", "Oncology", "1,754", "$13.20"],
            ["Dr. Jennifer Brown", "9012345678", "Rheumatology", "1,632", "$16.50"],
            ["Dr. Michael Davis", "0123456789", "Cardiology", "1,521", "$7.80"],
          ],
        },
        suggestedFollowups: [
          "What payers do Dr. Chen's patients use?",
          "Compare fill rates for top 10 vs average",
          "Show physician trends over last 13 weeks",
        ],
      },
    ],
  },
  {
    id: "thread-3",
    title: "OOP distribution for commercial plans",
    date: "Apr 5",
    messages: [
      { id: "m5", role: "user", content: "Show me OOP distribution for commercial plans" },
      {
        id: "m6",
        role: "agent",
        content: "Here's the out-of-pocket cost distribution across commercial plans:",
        agentActivity: { masterAgent: "Master Agent", routedTo: "Cortex Analyst", latency: "1.5s" },
        tableData: {
          headers: ["OOP Range", "Claims", "% of Total", "Avg OOP"],
          rows: [
            ["$0", "45,231", "28.4%", "$0.00"],
            ["$0.01–$10", "62,104", "39.0%", "$5.20"],
            ["$10.01–$25", "31,892", "20.0%", "$17.40"],
            ["$25.01–$50", "14,221", "8.9%", "$34.80"],
            ["$50+", "5,887", "3.7%", "$78.20"],
          ],
        },
        suggestedFollowups: [
          "Which plans have highest average OOP?",
          "How does OOP compare to prior year?",
          "Show OOP by therapy duration",
        ],
      },
    ],
  },
  {
    id: "thread-4",
    title: "Payer fill rate analysis — Humana",
    date: "Apr 1",
    messages: [
      { id: "m7", role: "user", content: "What's the fill rate for Humana plans?" },
      {
        id: "m8",
        role: "agent",
        content: "Here's the fill rate breakdown for Humana plans:",
        agentActivity: { masterAgent: "Master Agent", routedTo: "Cortex Analyst", latency: "1.1s" },
        tableData: {
          headers: ["Plan", "Submitted", "Dispensed", "Reversed", "Fill Rate"],
          rows: [
            ["Humana Gold Plus HMO", "8,421", "6,472", "1,949", "76.8%"],
            ["Humana Choice PPO", "5,234", "4,398", "836", "84.0%"],
            ["Humana Preferred PPO", "3,891", "3,307", "584", "84.9%"],
            ["Humana Walmart Rx", "2,102", "1,764", "338", "83.9%"],
          ],
        },
        suggestedFollowups: [
          "What are the top reversal reasons for Humana Gold?",
          "Compare Humana fill rate vs national average",
          "Show Humana fill rate trend over 13 weeks",
        ],
      },
    ],
  },
  {
    id: "thread-5",
    title: "13-week Brand1 forecast",
    date: "Mar 28",
    messages: [
      { id: "m9", role: "user", content: "Forecast Brand1 claims for the next 13 weeks" },
      {
        id: "m10",
        role: "agent",
        content: "I've generated a 13-week Prophet forecast for Brand1 total dispensed claims:",
        agentActivity: { masterAgent: "Master Agent", routedTo: "Prophet Forecasting Agent", latency: "4.2s" },
        tableData: {
          headers: ["Week", "Forecast", "Lower 80%", "Upper 80%"],
          rows: [
            ["Wk 1 (Apr 7)", "29,412", "28,100", "30,724"],
            ["Wk 2 (Apr 14)", "29,891", "28,320", "31,462"],
            ["Wk 3 (Apr 21)", "30,103", "28,490", "31,716"],
            ["Wk 4 (Apr 28)", "30,578", "28,810", "32,346"],
            ["Wk 5 (May 5)", "31,002", "29,100", "32,904"],
          ],
        },
        suggestedFollowups: [
          "Break down forecast by region",
          "How does this compare to prior year seasonality?",
          "Show forecast confidence interval chart",
        ],
      },
    ],
  },
];

export const workflows: WorkflowCard[] = [
  {
    id: "wf-1",
    name: "Brand1 Weekly Review",
    description: "Market share + 13-week rolling forecast",
    agentChain: [
      { id: "s1", type: "cortex-analyst", label: "Analyst", icon: "📊" },
      { id: "s2", type: "prophet", label: "Forecast", icon: "📈" },
    ],
    schedule: "auto",
    scheduleLabel: "Mon 8am",
    lastRun: "Apr 7, 2026",
    status: "success",
    runCount: 14,
  },
  {
    id: "wf-2",
    name: "Payer Segmentation Pipeline",
    description: "Claims analysis → clustering → per-segment forecast",
    agentChain: [
      { id: "s1", type: "cortex-analyst", label: "Analyst", icon: "📊" },
      { id: "s2", type: "clustering", label: "Cluster", icon: "🧩" },
      { id: "s3", type: "prophet", label: "Forecast", icon: "📈" },
    ],
    schedule: "manual",
    lastRun: "Apr 3, 2026",
    status: "success",
    runCount: 8,
  },
  {
    id: "wf-3",
    name: "Regional Driver Tracker",
    description: "Regional market share + decision tree driver analysis",
    agentChain: [
      { id: "s1", type: "cortex-analyst", label: "Analyst", icon: "📊" },
      { id: "s2", type: "mtree", label: "mTree", icon: "🌳" },
    ],
    schedule: "auto",
    scheduleLabel: "1st of Month",
    lastRun: "Apr 1, 2026",
    status: "success",
    runCount: 6,
  },
];

export const workflowRun: WorkflowRun = {
  id: "run-14",
  runNumber: 14,
  workflowId: "wf-2",
  startedAt: "Apr 7, 2026 11:02 PM",
  steps: [
    {
      stepId: "s1",
      label: "Cortex Analyst",
      icon: "📊",
      status: "done",
      duration: "1.4s",
      progress: 100,
      result: {
        type: "table",
        data: {
          headers: ["Plan Name", "Claims", "Fill Rate", "Avg OOP"],
          rows: [
            ["BlueCross PPO", "12,430", "87.2%", "$8.40"],
            ["Aetna HMO", "8,921", "82.1%", "$15.20"],
            ["UHC Choice Plus", "6,102", "79.5%", "$22.10"],
            ["Cigna OAP", "4,877", "84.3%", "$11.50"],
            ["Humana Gold", "3,214", "76.8%", "$28.70"],
          ],
        },
      },
    },
    {
      stepId: "s2",
      label: "GMM Clustering",
      icon: "🧩",
      status: "done",
      duration: "3.2s",
      progress: 100,
      result: {
        type: "segments",
        data: {
          segments: [
            {
              name: "High Performers",
              plans: ["BlueCross PPO", "Cigna OAP"],
              characteristics: "High fill rate, Low OOP",
              confidence: "Silhouette: 0.72",
            },
            {
              name: "At-Risk Payers",
              plans: ["Aetna HMO", "UHC Choice Plus", "Humana Gold"],
              characteristics: "Lower fill rate, High OOP",
              confidence: "Silhouette: 0.72",
            },
          ],
        },
      },
    },
    {
      stepId: "s3a",
      label: "Forecast — High Performers",
      icon: "📈",
      status: "running",
      progress: 68,
    },
    {
      stepId: "s3b",
      label: "Forecast — At-Risk Payers",
      icon: "📈",
      status: "pending",
      progress: 0,
    },
    {
      stepId: "output",
      label: "Combined Report",
      icon: "📋",
      status: "pending",
      progress: 0,
    },
  ],
};

export const semanticTables: SemanticTable[] = [
  {
    id: "rx-table",
    name: "RX_TABLE",
    icon: "💊",
    position: { x: 320, y: 80 },
    relations: [],
    columns: [
      { name: "claim_id", type: "INT", description: "Unique claim identifier (PK)", samples: "—" },
      { name: "claim_status_code", type: "INT", description: "1=Dispensed, 2=Reversed", samples: "1, 2" },
      { name: "date_rx_filled", type: "DATE", description: "Prescription fill date", samples: "2025-01-07" },
      { name: "ptd_final_claim", type: "INT", description: "Final claim flag", samples: "1, null" },
      { name: "primary_patient_pay", type: "FLOAT", description: "Patient out-of-pocket cost", samples: "0, 12.50" },
      { name: "primary_plan_pay", type: "FLOAT", description: "Plan payment amount", samples: "120.00, 0" },
      { name: "drug_id", type: "INT", description: "Drug identifier (FK → DRUG_TABLE)", samples: "—" },
      { name: "physician_key", type: "INT", description: "Prescriber key (FK → PHYS_REF)", samples: "—" },
      { name: "primary_plan_id", type: "INT", description: "Primary payer plan (FK → PLAN)", samples: "—" },
    ],
  },
  {
    id: "drug-table",
    name: "DRUG_TABLE",
    icon: "💊",
    position: { x: 60, y: 80 },
    relations: [{ targetTable: "rx-table", joinKey: "drug_id", label: "drug_id" }],
    columns: [
      { name: "drug_id", type: "INT", description: "Drug identifier (PK)", samples: "—" },
      { name: "brand_name", type: "VARCHAR", description: "Brand product name", samples: "Brand1" },
      { name: "generic_name", type: "VARCHAR", description: "Generic drug name", samples: "—" },
      { name: "ndc", type: "VARCHAR", description: "National Drug Code", samples: "12345-678-90" },
      { name: "strength", type: "VARCHAR", description: "Drug strength", samples: "10mg, 25mg" },
    ],
  },
  {
    id: "phys-ref",
    name: "PHYS_REF",
    icon: "👨‍⚕️",
    position: { x: 60, y: 260 },
    relations: [{ targetTable: "rx-table", joinKey: "physician_key", label: "physician_key" }],
    columns: [
      { name: "physician_key", type: "INT", description: "Physician surrogate key (PK)", samples: "—" },
      { name: "npi", type: "VARCHAR", description: "National Provider Identifier", samples: "1234567890" },
      { name: "first_name", type: "VARCHAR", description: "Physician first name", samples: "Sarah" },
      { name: "last_name", type: "VARCHAR", description: "Physician last name", samples: "Chen" },
      { name: "specialty", type: "VARCHAR", description: "Medical specialty", samples: "Oncology" },
      { name: "state", type: "CHAR(2)", description: "Practice state", samples: "NY, CA" },
    ],
  },
  {
    id: "plan",
    name: "PLAN",
    icon: "📋",
    position: { x: 60, y: 430 },
    relations: [{ targetTable: "rx-table", joinKey: "primary_plan_id", label: "primary_plan_id" }],
    columns: [
      { name: "primary_plan_id", type: "INT", description: "Plan identifier (PK)", samples: "—" },
      { name: "plan_name", type: "VARCHAR", description: "Insurance plan name", samples: "BlueCross PPO" },
      { name: "rgnl_org_typ", type: "VARCHAR", description: "Regional org type", samples: "INSURANCE CARRIER" },
      { name: "ntnl_org_typ", type: "VARCHAR", description: "National org type", samples: "INSURANCE CARRIER" },
      { name: "state", type: "CHAR(2)", description: "Plan state", samples: "NY, CA" },
    ],
  },
];

export const businessRules: BusinessRule[] = [
  {
    name: "Market Share",
    definition: "Claims-based (not patient count)",
    details: [
      "Filter: claim_status_code = 1 (Dispensed only)",
      "Filter: ptd_final_claim = 1 OR NULL (Exclude reversals)",
      "Denominator: Total dispensed claims for the molecule",
    ],
  },
  {
    name: "Fill Rate",
    definition: "Dispensed Claims / Submitted Claims",
    details: ["Submitted = All claims regardless of status", "Dispensed = claim_status_code = 1"],
  },
  {
    name: "Abandon Rate",
    definition: "Reversed Claims / Submitted Claims",
    details: ["Reversed = claim_status_code = 2"],
  },
  {
    name: "Regions",
    definition: "Census-based regional grouping",
    details: [
      "NE: CT, ME, MA, NH, RI, VT, NJ, NY, PA",
      "MW: IL, IN, MI, OH, WI, IA, KS, MN, MO, NE, ND, SD",
      "South: DE, FL, GA, MD, NC, SC, VA, WV, AL, KY, MS, TN, AR, LA, OK, TX",
      "West: AZ, CO, NV, NM, UT, WY, AK, CA, HI, OR, WA",
    ],
  },
  {
    name: "Plan Types",
    definition: "Organization type classification",
    details: [
      "Regional: RGNL_ORG_TYP = 'INSURANCE CARRIER'",
      "National: NTNL_ORG_TYP = 'INSURANCE CARRIER'",
      "Government: NTNL_ORG_TYP = 'GOVERNMENT'",
    ],
  },
];

const hcpTables: SemanticTable[] = [
  {
    id: "hcp-table",
    name: "HCP_TABLE",
    icon: "👨‍⚕️",
    position: { x: 60, y: 80 },
    relations: [{ targetTable: "territory", joinKey: "territory_id", label: "territory_id" }],
    columns: [
      { name: "physician_key", type: "INT", description: "Physician surrogate key (PK)", samples: "—" },
      { name: "npi", type: "VARCHAR", description: "National Provider Identifier", samples: "1234567890" },
      { name: "first_name", type: "VARCHAR", description: "Physician first name", samples: "Sarah" },
      { name: "last_name", type: "VARCHAR", description: "Physician last name", samples: "Chen" },
      { name: "specialty", type: "VARCHAR", description: "Medical specialty", samples: "Oncology" },
      { name: "territory_id", type: "INT", description: "Sales territory (FK → TERRITORY)", samples: "—" },
      { name: "decile", type: "INT", description: "Prescribing decile 1-10", samples: "8, 9, 10" },
      { name: "total_rx_ytd", type: "INT", description: "Total Rx dispensed YTD", samples: "1200, 340" },
    ],
  },
  {
    id: "territory",
    name: "TERRITORY",
    icon: "🗺️",
    position: { x: 340, y: 80 },
    relations: [],
    columns: [
      { name: "territory_id", type: "INT", description: "Territory identifier (PK)", samples: "—" },
      { name: "territory_name", type: "VARCHAR", description: "Territory name", samples: "NY-EAST" },
      { name: "rep_name", type: "VARCHAR", description: "Sales rep assigned", samples: "John Smith" },
      { name: "region", type: "VARCHAR", description: "Geographic region", samples: "North East" },
      { name: "target_hcp_count", type: "INT", description: "Number of targeted HCPs", samples: "85, 120" },
    ],
  },
];

const accessTables: SemanticTable[] = [
  {
    id: "access-table",
    name: "ACCESS_TABLE",
    icon: "🏥",
    position: { x: 60, y: 80 },
    relations: [{ targetTable: "formulary", joinKey: "plan_id", label: "plan_id" }],
    columns: [
      { name: "access_id", type: "INT", description: "Access record identifier (PK)", samples: "—" },
      { name: "plan_id", type: "INT", description: "Insurance plan (FK → FORMULARY)", samples: "—" },
      { name: "drug_id", type: "INT", description: "Drug identifier", samples: "—" },
      { name: "coverage_status", type: "VARCHAR", description: "Covered / Not Covered / Restricted", samples: "Covered" },
      { name: "pa_required", type: "BOOLEAN", description: "Prior authorization required", samples: "true, false" },
      { name: "step_edit", type: "BOOLEAN", description: "Step therapy required", samples: "false" },
      { name: "effective_date", type: "DATE", description: "Coverage effective date", samples: "2025-01-01" },
    ],
  },
  {
    id: "formulary",
    name: "FORMULARY",
    icon: "📋",
    position: { x: 340, y: 80 },
    relations: [],
    columns: [
      { name: "plan_id", type: "INT", description: "Plan identifier (PK)", samples: "—" },
      { name: "plan_name", type: "VARCHAR", description: "Insurance plan name", samples: "BlueCross PPO" },
      { name: "tier", type: "INT", description: "Formulary tier (1-5)", samples: "2, 3" },
      { name: "copay_preferred", type: "FLOAT", description: "Preferred tier copay", samples: "25.00" },
      { name: "copay_non_preferred", type: "FLOAT", description: "Non-preferred tier copay", samples: "75.00" },
      { name: "lives_covered", type: "INT", description: "Covered lives in plan", samples: "1200000" },
    ],
  },
];

export const semanticModels: SemanticModel[] = [
  {
    id: "cortex-testcase",
    name: "CORTEX_TESTCASE",
    description: "Live Snowflake semantic view — Rx, drug, physician & plan data",
    tables: semanticTables,
  },
  {
    id: "hcp-model",
    name: "HCP Universe",
    description: "Physician targeting, deciles & territory alignment",
    tables: hcpTables,
  },
  {
    id: "access-model",
    name: "Market Access",
    description: "Formulary coverage, PA requirements & access barriers",
    tables: accessTables,
  },
];

export const agentPalette = [
  { type: "cortex-analyst", label: "Cortex Analyst", icon: "📊", description: "SQL-based analytical queries against Snowflake" },
  { type: "clustering", label: "GMM Clustering", icon: "🧩", description: "Unsupervised segmentation via Gaussian Mixture Models" },
  { type: "prophet", label: "Prophet Forecast", icon: "📈", description: "Time-series forecasting with trend + seasonality" },
  { type: "sarima", label: "SARIMA", icon: "📉", description: "Seasonal ARIMA for stationary time series" },
  { type: "xgboost", label: "XGBoost", icon: "🤖", description: "Gradient-boosted trees for classification/regression" },
  { type: "mtree", label: "mTree / Decision Tree", icon: "🌳", description: "Driver analysis and segment explainability" },
];
