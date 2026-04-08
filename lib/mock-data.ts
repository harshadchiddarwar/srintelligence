import {
  RecentAnalysis,
  ChatThread,
  WorkflowCard,
  WorkflowRun,
  SemanticTable,
  SemanticModel,
  BusinessRule,
} from "./types";

export const recentAnalyses: RecentAnalysis[] = [];

export const chatThreads: ChatThread[] = [];

export const workflows: WorkflowCard[] = [];

export const workflowRun: WorkflowRun = {
  id: "run-14",
  runNumber: 14,
  workflowId: "wf-2",
  startedAt: "Apr 7, 2026 11:02 PM",
  steps: [
    {
      stepId: "s1",
      label: "SRI Analytics",
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
    id: "analytics",
    name: "Analytics",
    description: "Rx claims, drug reference, physicians & plan data",
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
  { type: "sri-forecast",   label: "Forecast",         icon: "📈", description: "Time-series demand forecasting (Prophet, SARIMA, XGBoost, Hybrid)" },
  { type: "sri-clustering", label: "Clustering",        icon: "🧩", description: "Unsupervised segmentation (GMM, K-Means, DBSCAN, K-Medoids, Hierarchical)" },
  { type: "sri-mtree",      label: "mTree™",            icon: "🌳", description: "Driver analysis & waterfall explainability" },
  { type: "sri-causal",     label: "Causal Inference",  icon: "🔬", description: "4-phase causal discovery: contribution → drivers → DML → narrative" },
];
