import { NextRequest } from "next/server";

// ── Snowflake config ──────────────────────────────────────────────────────────
const ACCOUNT   = process.env.SNOWFLAKE_ACCOUNT!;   // e.g. hj98757.us-east-1
const PAT       = process.env.SNOWFLAKE_PAT!;
const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE!;
const DATABASE  = process.env.SNOWFLAKE_DATABASE!;
const BASE_URL  = `https://${ACCOUNT}.snowflakecomputing.com`;

const SEMANTIC_VIEW = "CORTEX_TESTING.PUBLIC.CORTEX_TESTCASE";

// ── Shared headers ────────────────────────────────────────────────────────────
function sfHeaders() {
  return {
    Authorization: `Bearer ${PAT}`,
    "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "SRIntelligence/1.0",
  };
}

// ── Cortex Analyst types ──────────────────────────────────────────────────────
interface CortexMessage {
  role: "user" | "analyst";
  content: Array<{ type: string; text?: string; statement?: string; suggestions?: string[] }>;
}

// ── Call Cortex Analyst ───────────────────────────────────────────────────────
async function callCortexAnalyst(messages: CortexMessage[]) {
  const res = await fetch(`${BASE_URL}/api/v2/cortex/analyst/message`, {
    method: "POST",
    headers: sfHeaders(),
    body: JSON.stringify({
      messages,
      semantic_view: SEMANTIC_VIEW,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cortex Analyst ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Execute SQL via Snowflake SQL API ─────────────────────────────────────────
async function executeSQL(sql: string): Promise<{ headers: string[]; rows: (string | number)[][] }> {
  const res = await fetch(`${BASE_URL}/api/v2/statements`, {
    method: "POST",
    headers: sfHeaders(),
    body: JSON.stringify({
      statement: sql,
      timeout: 60,
      database: DATABASE,
      schema: "PUBLIC",
      warehouse: WAREHOUSE,
      parameters: { MULTI_STATEMENT_COUNT: "0" },
    }),
  });

  // 200 = sync success, 202 = async (need to poll)
  if (res.status === 202) {
    const init = await res.json();
    return pollSQL(init.statementHandle as string);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SQL API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return parseSQLResult(data);
}

async function pollSQL(handle: string): Promise<{ headers: string[]; rows: (string | number)[][] }> {
  const url = `${BASE_URL}/api/v2/statements/${handle}`;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await fetch(url, { headers: sfHeaders() });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Poll ${res.status}: ${body}`);
    }
    const data = await res.json();
    if (data.status === "success") return parseSQLResult(data);
    if (data.status === "failed") throw new Error(data.message ?? "SQL failed");
  }
  throw new Error("SQL query timed out after 30 seconds");
}

function parseSQLResult(data: {
  resultSetMetaData?: { rowType?: Array<{ name: string }> };
  data?: (string | number)[][];
}): { headers: string[]; rows: (string | number)[][] } {
  const cols = data.resultSetMetaData?.rowType ?? [];
  const rows = data.data ?? [];
  const headers = cols.map((c) => c.name);
  // Snowflake returns everything as strings; cast numeric-looking cells to numbers
  const typedRows = rows.map((row) =>
    row.map((cell) => {
      if (cell === null || cell === undefined) return "";
      const n = Number(cell);
      return !isNaN(n) && cell !== "" ? n : cell;
    })
  );
  return { headers, rows: typedRows };
}

// ── Derive chart data from a table ───────────────────────────────────────────
function deriveChart(
  tableData: { headers: string[]; rows: (string | number)[][] }
): Array<{ name: string; value: number }> | null {
  const { headers, rows } = tableData;
  if (!rows.length || headers.length < 2) return null;

  // First column = label, first numeric column = value
  const valueIdx = headers.findIndex(
    (_, i) => i > 0 && rows.some((r) => typeof r[i] === "number")
  );
  if (valueIdx < 0) return null;

  return rows.slice(0, 25).map((row) => ({
    name: String(row[0]),
    value: typeof row[valueIdx] === "number" ? (row[valueIdx] as number) : 0,
  }));
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      query: string;
      history?: CortexMessage[];
    };
    const { query, history = [] } = body;

    if (!query?.trim()) {
      return Response.json({ error: "query is required" }, { status: 400 });
    }

    const t0 = Date.now();

    // Build full conversation history for Cortex Analyst
    const messages: CortexMessage[] = [
      ...history,
      { role: "user", content: [{ type: "text", text: query }] },
    ];

    // ── Step 1: get SQL from Cortex Analyst ──────────────────────────────────
    let analystResponse: {
      message: { role: string; content: Array<{ type: string; text?: string; statement?: string; suggestions?: string[] }> };
      request_id?: string;
      warnings?: string[];
    };

    try {
      analystResponse = await callCortexAnalyst(messages);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: `Cortex Analyst error: ${msg}` }, { status: 502 });
    }

    const content = analystResponse.message?.content ?? [];
    const textBlock       = content.find((c) => c.type === "text");
    const sqlBlock        = content.find((c) => c.type === "sql");
    const suggestionsBlock = content.find((c) => c.type === "suggestions");

    // ── Step 2: execute the SQL if present ───────────────────────────────────
    let tableData: { headers: string[]; rows: (string | number)[][] } | null = null;
    let chartData: Array<{ name: string; value: number }> | null = null;
    let sqlError: string | null = null;

    if (sqlBlock?.statement) {
      try {
        tableData = await executeSQL(sqlBlock.statement);
        chartData = deriveChart(tableData);
      } catch (err: unknown) {
        sqlError = err instanceof Error ? err.message : String(err);
        console.error("[/api/cortex] SQL execution error:", sqlError);
      }
    }

    const latency = ((Date.now() - t0) / 1000).toFixed(1) + "s";

    // The analyst message to append to history for next turn
    const analystHistoryMessage: CortexMessage = analystResponse.message as CortexMessage;

    return Response.json({
      content: textBlock?.text ?? "Analysis complete.",
      sql: sqlBlock?.statement ?? null,
      sqlError,
      tableData,
      chartData,
      suggestedFollowups: suggestionsBlock?.suggestions ?? [],
      latency,
      // Return the full analyst message so the client can append it to history
      analystMessage: analystHistoryMessage,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/cortex] Unhandled error:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
