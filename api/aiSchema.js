/**
 * Middle-agent knowledge base — the COMPLETE Supabase schema for K12 Central.
 *
 * `SCHEMA_KNOWLEDGE` is the single source of truth injected into the Query
 * Interpreter ("middle agent") so it can translate vague user queries into a
 * precise structured request for the Groq API. Any table/field/value-domain
 * question the interpreter can answer lives HERE.
 *
 * Exported:
 *   SCHEMA_KNOWLEDGE  — full knowledge object (see below)
 *   INTERPRETER_SYSTEM — the Query Interpreter system prompt
 *   INTERPRETATION_SCHEMA — JSON schema of the structured interpretation
 *
 * NOTE: this file is plain JS (no build step) so the Vercel serverless
 * function `api/ask-ai.js` can import it directly, exactly like the dev shim.
 * The GROQ_API_KEY / NVIDIA_API_KEY environment variables must be set on the
 * Vercel project (all environments) for the provider chain to come online.
 */

// ---------------------------------------------------------------------------
// Supabase tables
// ---------------------------------------------------------------------------

const TABLES = {
  payment_report_rows: {
    description:
      "Historic payment report. ONE ROW = ONE STUDENT'S FIRST PAYMENT of the session year (a student appears once per session_year). Counting rows = counting students who paid.",
    approxRows: "229,602 total across session years",
    fields: {
      id: "number. Surrogate primary key — no analytical meaning.",
      branch:
        "text. Eduvate branch name of the school, e.g. 'OIS New Town Kolkata', 'ICSE Whitefield'. Copy values EXACTLY from source.zoneByBranch keys — never invent or re-spell branch names.",
      enrollment_code:
        "text. Student's ERP enrollment code. PREFIX encodes the admission cohort year and drives the derived student_type (see derivedFields.student_type). Not normally useful for filtering.",
      grade:
        "text. Grade level exactly as ERP spells it: pre-primary 'K1'/'K2', then 'Grade 1'..'Grade 12'. Not '6th', not 'Class 6', not 'VI'.",
      student_type:
        "text as stored: 'NEW' or 'OLD' (ERP uppercase). The tool arg expects 'New'/'Old' title case.",
      first_paid_date:
        "text (NOT a real date column), format 'yyyy-mm-dd' (occasionally 'yyyy-mm-dd HH:mm:ss'). Comparisons in the tool are lexicographic and inclusive: dateFrom <= value <= dateTo. Empty string '' = never paid / no date.",
      fetched_at: "timestamptz. When this row snapshot was pulled from Eduvate — metadata, never filter on it.",
      session_year:
        "text. Academic session — exactly one of '2026-27', '2025-26', '2024-25'. One row per student per session year. The page shows ONE year (source.year) by default; for cross-year or whole-database questions pass sessionYears:[\"2025-26\"] or allYears:true to query_payments, or groupBy 'session_year' to compare years.",
    },
  },

  historic_fetch_log: {
    description: "Operational log of when each yearly report was last fetched from Eduvate.",
    fields: {
      report_key: "text, unique. 'payment_report:<session_year>', e.g. 'payment_report:2026-27'.",
      last_status: "text. 'ok' when the snapshot is healthy.",
      last_fetched_at: "timestamptz. Drives the stale-while-revalidate cache logic.",
    },
    note: "Not exposed to Ask AI tools — knowledge only.",
  },

  report_config: {
    description: "Key/value configuration store (value is jsonb).",
    fields: {
      config_key: "text, unique. See configKeys below.",
      value: "jsonb payload — shape depends on the key.",
      updated_at: "timestamptz.",
    },
    configKeys: {
      grn_branch_zbh_mapping:
        "~137 rows of { branchEduvate, zone }. This IS the definition of the derived zone field: branch → Zone (ZBH region). Zones are broad regions like 'Bangalore', 'North 1', 'Kolkata'.",
      historic_icse_config:
        "Array of { branch, grade } rules. A payment row is segment 'ICSE' when its (branch, grade) matches a rule case-insensitively, else 'OIS'. This IS the definition of the derived segment field.",
    },
    note: "The widget resolves both configs before the AI runs; the interpreter never queries them directly.",
  },

  grn_uploads: {
    description:
      "The Pending-GRN file the user uploads on the Pending GRN page (source.kind = 'grn_file'). Columns are whatever the file has — ALWAYS take column names from source.columns, never guess.",
    fields: {
      "(dynamic columns)": "headers come from source.columns; groupBy/aggregate/filters must reference them exactly.",
    },
  },
};

// ---------------------------------------------------------------------------
// Derived fields (computed in the browser, NOT stored columns)
// ---------------------------------------------------------------------------

const DERIVED_FIELDS = {
  zone:
    "Join payment_report_rows.branch → report_config.grn_branch_zbh_mapping (branchEduvate → zone). Unmapped branches group as '(Unmapped)'. Filter with the zones arg.",
  segment:
    "'ICSE' when (branch, grade) matches a historic_icse_config rule (case-insensitive), else 'OIS'. Only two values. Filter with the segments arg.",
  student_type:
    "ERP admission cohort: enrollment-code prefix per session year (26/25/24) → 'New' (joined that session year) vs 'Old'. Values are exactly 'New'/'Old'. Filter with the studentTypes arg.",
  month:
    "first_paid_date truncated to 'yyyy-mm' — available only as groupBy 'month', not as a filter. A date RANGE is the way to filter time.",
};

// ---------------------------------------------------------------------------
// Value domains (what 'exact match' really means)
// ---------------------------------------------------------------------------

const VALUE_DOMAINS = {
  sessionYears: "Exactly '2026-27' (current), '2025-26', '2024-25'. allYears:true means all three.",
  zones: "Copy from source.zones (derived from the branch→zone mapping), e.g. 'Bangalore', 'Kolkata'.",
  branches: "Copy EXACTLY from source.zoneByBranch keys, e.g. 'OIS New Town Kolkata'.",
  grades: "Exact ERP spelling: 'K1', 'K2', 'Grade 1' … 'Grade 12'. Never '6th'/'Class 6'/'VI'.",
  studentTypes: "Exactly 'New' or 'Old'.",
  segments: "Exactly 'ICSE' or 'OIS'.",
  dates:
    "Inclusive 'yyyy-mm-dd'. 'January' alone means Jan 1–31, but WHICH academic year is a key dimension: when the year is not stated in the question, do not silently assume source.year — ask (see step 6) with session-year options.",
  sessionYearClarify:
    "When a question about payments does not name an academic year, the natural clarifying question is which year's payments are meant, with options like '2026-27', '2025-26', '2024-25' and 'All years'.",
};

// ---------------------------------------------------------------------------
// The assembled knowledge object (injected into the interpreter)
// ---------------------------------------------------------------------------

export const SCHEMA_KNOWLEDGE = {
  tables: TABLES,
  derivedFields: DERIVED_FIELDS,
  valueDomains: VALUE_DOMAINS,
  grnNote:
    "When source.kind = 'grn_file', the payments table does not apply — every filter/group/aggregate column must come from source.columns (header names of the uploaded file). The last uploaded GRN file is saved in the database, so analyze_grn also works from other pages.",
  noneNote:
    "When source.kind = 'none' the page has no data of its own — but the DATABASE is still fully available: query_payments (all academic years) and analyze_grn (last saved GRN) both work. Never answer that there is no data without calling a tool first.",
};

// ---------------------------------------------------------------------------
// Structured interpretation the middle agent must emit
// ---------------------------------------------------------------------------

export const INTERPRETATION_SCHEMA = {
  type: "object",
  properties: {
    understanding: {
      type: "string",
      description:
        "One sentence: what the user wants, with typos fixed and relative dates resolved (e.g. 'Count ICSE first payments in March 2026').",
    },
    assumptions: {
      type: "array",
      items: { type: "string" },
      description: "Non-obvious choices you made (max 3), e.g. 'Interpreted \"jan\" as January 2026-27'.",
    },
    tool: {
      type: ["string", "null"],
      enum: ["query_payments", "analyze_grn", null],
    },
    args: { type: "object", description: "Exact arguments for the chosen tool — returned to the main agent." },
    needsClarification: { type: "boolean" },
    clarification: { type: "string", description: "Short natural question for the user when needsClarification is true (e.g. \"Ok — but which year's payments are you asking for?\")." },
    clarificationOptions: {
      type: "array",
      items: { type: "string" },
      description:
        "When needsClarification is true: 2-5 SHORT candidate answers the user can click, most likely first, copied EXACTLY from the source descriptor / value domains (academic years: '2026-27', '2025-26', '2024-25', plus 'All years' when every year is plausible). Empty array when no clarification is needed.",
    },
  },
  required: ["understanding", "tool", "args", "needsClarification"],
};

// ---------------------------------------------------------------------------
// Query Interpreter system prompt (the middle agent)
// ---------------------------------------------------------------------------

export function buildInterpreterPrompt(source, today) {
  return [
    "You are the QUERY INTERPRETER — a middle agent between the user and the data tool-caller of K12 Central System (a school-logistics console for K12 Techno Services).",
    "Your ONLY job: translate the user's latest message into a precise, structured request the tool-calling agent can execute. You do NOT answer the question yourself and you never see data.",
    "",
    "=== SUPABASE / DATA KNOWLEDGE (authoritative) ===",
    JSON.stringify(SCHEMA_KNOWLEDGE),
    "",
    "=== PAGE DATA SOURCE (live descriptor for the page the user is on) ===",
    JSON.stringify(source),
    "",
    "=== PROCEDURE ===",
    "1. Read the user's LATEST message in the conversation (the last user turn). Earlier turns are context only.",
    "2. Correct typos and normalize wording BEFORE mapping: 'Bangaloer' → Bangalore, 'jan'/'Jan' → exact month bounds of the report year, '6th' → 'Grade 6', 'new students' → studentTypes ['New'].",
    "3. Resolve relative dates against TODAY (" + today + ") and the report year (source.year for payments): 'this month', 'last month', 'jan', 'last 3 months' → exact inclusive yyyy-mm-dd dateFrom/dateTo.",
    "4. Map the intent to EXACT value domains (grades = 'Grade 6' not '6th'; zones/branches copied verbatim from the source descriptor; segments only 'ICSE'/'OIS'; studentTypes only 'New'/'Old').",
    "5. Choose the tool from the page kind: payments → query_payments, grn_file → analyze_grn. Fill args fully and explicitly (include groupBy when the user asks per-group/per-branch/per-month breakdowns; omit it for a single total; prefer groupBy 'month' for time trends, 'session_year' to compare academic years).",
    "5b. Use the EXACT argument shapes below — the tools reject anything else:\n" +
      "    query_payments args: { zones?: string[], branches?: string[], grades?: string[], studentTypes?: ('New'|'Old')[], segments?: ('ICSE'|'OIS')[], sessionYears?: string[], allYears?: boolean, dateFrom?: 'yyyy-mm-dd', dateTo?: 'yyyy-mm-dd', groupBy?: 'zone'|'branch'|'grade'|'student_type'|'segment'|'month'|'session_year', limit?: number }. groupBy is ONE string, not a list; there is no aggregate/orderBy/field field — counts are what query_payments returns.\n" +
      "    analyze_grn args: { filters?: [{column, op, value}], groupBy?: string|string[], aggregate?: {op: 'count'|'sum'|'avg'|'min'|'max', column?}, sortBy?: {by: 'count'|'value'|'group', dir: 'asc'|'desc'}, limit?: number }. Column names must match source.columns EXACTLY (copy them verbatim, e.g. 'Plant Name'); if you don't know them, pass only groupBy and read availableColumns from the error.\n" +
      "    forecast_payments args: { zone: string (EXACT from source.zones), targetYear?: string (default '2027-28'), branches?: string[], segments?: ('ICSE'|'OIS')[], studentTypes?: ('New'|'Old')[] }.\n" +
      "    When the user asks for a 'top N' ranking, set groupBy + sortBy {by:'count', dir:'desc'} (or 'value' for sum/avg) and limit.",
    "5b. If the question spans academic years or the whole database ('across all years', 'since 2024', 'total overall'), set sessionYears or allYears:true on query_payments — the page's year alone would under-report. This works from ANY page.",
    "5c. FUTURE/PREDICTION questions ('what will payments be in 2027-28', 'predict', 'forecast', 'estimate next year', 'how many can we expect') are NOT answerable by querying the past — choose tool 'forecast_payments' with the zone copied EXACTLY from source.zones and targetYear from the question. If the zone is ambiguous or missing, ask for clarification with zone options. Past-year questions ('what were 2025-26 payments') stay on query_payments.",
    "6. CLARIFY LIKE A DATA ANALYST: if a KEY dimension of the request is ambiguous — which academic year (e.g. 'total payments in January' names no year), zone vs branch, what metric 'top/best' means, which date range a vague phrase covers, which column of a GRN file is meant — DO NOT guess silently. Set needsClarification:true, write a short, friendly follow-up question in clarification the way a data analyst would ('Ok — but which year's payments are you asking for?'), and fill clarificationOptions with 2-5 clickable candidate answers copied EXACTLY from the source descriptor or value domains (e.g. session years ['2026-27','2025-26','2024-25','All years']; zones copied verbatim from source.zones; grades as 'Grade 6'). Most likely candidate FIRST. The user will click one and you'll reinterpret their completed request on the next turn — write clarification so their clicked answer slots straight back into the original question.\n" +
      "    Only fall back to assumptions (no clarification) for genuinely trivial readings: a fixed typo, 'Bangalore' being the ZONE not a branch, a lone month meaning Jan 1–31. When in doubt between assuming and asking for a key dimension like the year — ASK, but keep it to ONE short question with options.",
    "7. If source.kind = 'none' the page still has whole-database access — never ask for clarification about where the data comes from; clarify only about the question itself (year, scope, metric).",
    "",
    "=== OUTPUT (STRICT) ===",
    "Reply with ONE JSON object and nothing else (no markdown fences, no prose):",
    JSON.stringify(INTERPRETATION_SCHEMA),
    "For a chit-chat message (greetings, thanks) set tool to null, needsClarification false, and put a suitable reply in understanding — the orchestrator will answer directly without tools.",
  ].join("\n");
}
