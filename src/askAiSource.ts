import { useSyncExternalStore } from "react";

/**
 * Agentic "Ask AI" — client side.
 *
 * The server model no longer receives a fixed summary. It receives a light
 * DATA-SOURCE descriptor and decides what it needs, emitting tool calls.
 * This module:
 *   1. builds the descriptor for the page the user is on (payments from
 *      Supabase rows in memory / the uploaded Pending-GRN file / none), and
 *   2. executes the model's tool calls against that live data.
 *
 * The uploaded GRN file exists only in the browser, so tools run here — the
 * server stays a pure LLM-orchestration step and the widget loops until the
 * model answers.
 */

// ---------------------------------------------------------------------------
// GRN source registry (uploaded file on the Pending GRN page)
// ---------------------------------------------------------------------------

export type GrnSource = {
  fileName: string;
  columns: string[];
  rowCount: number;
  /** Returns the raw cell matrix (row = array of cells) at call time. */
  getRows: () => (string | number)[][];
};

let grnSource: GrnSource | null = null;
const grnListeners = new Set<() => void>();

export function registerGrnSource(s: GrnSource) {
  grnSource = s;
  grnListeners.forEach((l) => l());
}
export function unregisterGrnSource() {
  if (grnSource) {
    grnSource = null;
    grnListeners.forEach((l) => l());
  }
}
export function getGrnSource(): GrnSource | null {
  return grnSource;
}
function subscribeGrn(cb: () => void) {
  grnListeners.add(cb);
  return () => grnListeners.delete(cb);
}
/** Re-renders the caller whenever a GRN file is registered/cleared. */
export function useGrnSource(): GrnSource | null {
  return useSyncExternalStore(subscribeGrn, getGrnSource, getGrnSource);
}

// ---------------------------------------------------------------------------
// Payments rows (enriched once, reused by every tool call)
// ---------------------------------------------------------------------------

export type PaymentRowLite = {
  zone: string;
  branch: string;
  grade: string;
  student_type: string;
  segment: string;
  first_paid_date: string;
  session_year: string;
};

/** Every academic year present in the database (payment_report_rows). */
export const ALL_SESSION_YEARS = ["2026-27", "2025-26", "2024-25"] as const;

export function enrichPayments(
  rows: Array<{
    branch: string;
    grade: string;
    student_type: string;
    first_paid_date: string;
    session_year?: string;
  }>,
  zoneByBranch: Map<string, string>,
  icseKeys: Set<string>
): PaymentRowLite[] {
  return rows.map((r) => {
    const key = `${r.branch.trim().toLowerCase()}|${r.grade.trim().toLowerCase()}`;
    return {
      zone: zoneByBranch.get(r.branch) || "(Unmapped)",
      branch: r.branch,
      grade: r.grade,
      student_type: r.student_type,
      segment: icseKeys.has(key) ? "ICSE" : "OIS",
      first_paid_date: r.first_paid_date ?? "",
      session_year: r.session_year ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Tool: query_payments
// ---------------------------------------------------------------------------

type PaymentsArgs = {
  zones?: string[];
  branches?: string[];
  grades?: string[];
  studentTypes?: string[];
  segments?: string[];
  /** Academic years to include, e.g. ["2024-25"]. Omit = current page's year. */
  sessionYears?: string[];
  /** true = query EVERY academic year in the database. */
  allYears?: boolean;
  dateFrom?: string;
  dateTo?: string;
  groupBy?: "zone" | "branch" | "grade" | "student_type" | "segment" | "month" | "session_year" | null;
  withMonths?: boolean;
  limit?: number;
};

const GROUP_FIELDS = ["zone", "branch", "grade", "student_type", "segment", "session_year"] as const;

function monthKey(dateStr: string): string {
  return /^\d{4}-\d{2}/.test(dateStr) ? dateStr.slice(0, 7) : "(no date)";
}

function normList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const arr = v.map((x) => String(x).trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

export function executeQueryPayments(
  rows: PaymentRowLite[],
  rawArgs: PaymentsArgs
): Record<string, unknown> {
  const args = rawArgs ?? {};
  const zones = normList(args.zones)?.map((z) => z.toLowerCase());
  const branches = normList(args.branches)?.map((b) => b.toLowerCase());
  const grades = normList(args.grades)?.map((g) => g.toLowerCase());
  const studentTypes = normList(args.studentTypes)?.map((s) => s.toLowerCase());
  const segments = normList(args.segments)?.map((s) => s.toLowerCase());
  const years = args.allYears ? undefined : normList(args.sessionYears)?.map((y) => y.toLowerCase());
  const dateFrom = typeof args.dateFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.dateFrom) ? args.dateFrom : undefined;
  const dateTo = typeof args.dateTo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.dateTo) ? args.dateTo : undefined;
  const groupBy = GROUP_FIELDS.includes(args.groupBy as never) || args.groupBy === "month" ? args.groupBy : null;
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);

  const match = (r: PaymentRowLite): boolean => {
    if (!args.allYears && years && !years.includes((r.session_year ?? "").toLowerCase())) return false;
    if (zones && !zones.includes(r.zone.toLowerCase())) return false;
    if (branches && !branches.includes(r.branch.toLowerCase())) return false;
    if (grades && !grades.includes(r.grade.toLowerCase())) return false;
    if (studentTypes && !studentTypes.includes(r.student_type.toLowerCase())) return false;
    if (segments && !segments.includes(r.segment.toLowerCase())) return false;
    const d = r.first_paid_date;
    if (dateFrom && (!d || d < dateFrom)) return false;
    if (dateTo && (!d || d > dateTo)) return false;
    return true;
  };

  const groups = new Map<string, { count: number; byMonth: Map<string, number> }>();
  const matchedMonths = new Set<string>();
  let total = 0;

  for (const r of rows) {
    if (!match(r)) continue;
    total++;
    const mk = monthKey(r.first_paid_date);
    matchedMonths.add(mk);
    if (groupBy) {
      const key = groupBy === "month" ? mk : (r[groupBy] || "(blank)");
      let g = groups.get(key);
      if (!g) {
        g = { count: 0, byMonth: new Map() };
        groups.set(key, g);
      }
      g.count++;
      g.byMonth.set(mk, (g.byMonth.get(mk) ?? 0) + 1);
    }
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, limit);
  const outGroups = sorted.map(([key, g]) => ({
    key,
    count: g.count,
    ...(groupBy && args.withMonths !== false
      ? { byMonth: Object.fromEntries([...g.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) }
      : {}),
  }));

  return {
    tool: "query_payments",
    filtersEcho: {
      ...(args.allYears ? { allYears: true } : {}),
      ...(years ? { sessionYears: years } : {}),
      ...(zones ? { zones } : {}),
      ...(branches ? { branches } : {}),
      ...(grades ? { grades } : {}),
      ...(studentTypes ? { studentTypes } : {}),
      ...(segments ? { segments } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    },
    totalMatching: total,
    groupCount: groups.size,
    ...(groupBy ? { groups: outGroups } : {}),
    availableMonths: [...matchedMonths].sort(),
    years: [...new Set(rows.map((r) => r.session_year).filter(Boolean))].sort(),
  };
}

// ---------------------------------------------------------------------------
// Tool: analyze_grn (uploaded Pending-GRN file)
// ---------------------------------------------------------------------------

type GrnArgs = {
  filters?: Array<{ column: string; op: string; value: unknown }>;
  groupBy?: string | string[];
  aggregate?: { op?: string; column?: string };
  sortBy?: { by?: string; dir?: string };
  limit?: number;
};

const GRN_OPS = new Set(["eq", "neq", "contains", "gt", "gte", "lt", "lte"]);

function toNumber(v: string): number {
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
}

export function executeAnalyzeGrn(
  source: GrnSource,
  rawArgs: GrnArgs
): Record<string, unknown> {
  const args = rawArgs ?? {};
  const columns = source.columns;
  const colIndex = new Map<string, number>();
  columns.forEach((c, i) => colIndex.set(c.trim().toLowerCase(), i));

  const resolveCol = (name: unknown): number | null => {
    const idx = colIndex.get(String(name ?? "").trim().toLowerCase());
    return idx === undefined ? null : idx;
  };

  // Validate filters up-front so the model can self-correct on typos.
  const filters: Array<{ idx: number; column: string; op: string; value: unknown }> = [];
  for (const f of Array.isArray(args.filters) ? args.filters : []) {
    const idx = resolveCol(f?.column);
    if (idx === null) {
      return { tool: "analyze_grn", error: `Unknown column "${String(f?.column)}".`, availableColumns: columns };
    }
    const op = String(f?.op ?? "eq").toLowerCase();
    if (!GRN_OPS.has(op)) {
      return { tool: "analyze_grn", error: `Unknown op "${op}". Use one of: ${[...GRN_OPS].join(", ")}.`, availableColumns: columns };
    }
    filters.push({ idx, column: columns[idx], op, value: f?.value });
  }

  const rows = source.getRows();
  const match = (cells: (string | number)[]): boolean => {
    for (const f of filters) {
      const cell = String(cells[f.idx] ?? "").trim();
      const fStr = String(f.value ?? "").trim();
      const numCell = toNumber(cell);
      const numVal = toNumber(fStr);
      const numeric = !Number.isNaN(numCell) && !Number.isNaN(numVal) && fStr !== "";
      let ok: boolean;
      switch (f.op) {
        case "eq": ok = numeric ? numCell === numVal : cell.toLowerCase() === fStr.toLowerCase(); break;
        case "neq": ok = numeric ? numCell !== numVal : cell.toLowerCase() !== fStr.toLowerCase(); break;
        case "contains": ok = cell.toLowerCase().includes(fStr.toLowerCase()); break;
        case "gt": ok = numeric ? numCell > numVal : cell > fStr; break;
        case "gte": ok = numeric ? numCell >= numVal : cell >= fStr; break;
        case "lt": ok = numeric ? numCell < numVal : cell < fStr; break;
        case "lte": ok = numeric ? numCell <= numVal : cell <= fStr; break;
        default: ok = true;
      }
      if (!ok) return false;
    }
    return true;
  };

  const matched = rows.filter(match);

  const groupCols: number[] = [];
  for (const g of Array.isArray(args.groupBy) ? args.groupBy : args.groupBy ? [args.groupBy] : []) {
    const idx = resolveCol(g);
    if (idx === null) {
      return { tool: "analyze_grn", error: `Unknown groupBy column "${String(g)}".`, availableColumns: columns };
    }
    groupCols.push(idx);
  }

  const aggOp = String(args.aggregate?.op ?? "").toLowerCase();
  let aggIdx: number | null = null;
  if (aggOp) {
    if (!["count", "sum", "avg", "min", "max"].includes(aggOp)) {
      return { tool: "analyze_grn", error: `Unknown aggregate op "${aggOp}". Use: count, sum, avg, min, max.` };
    }
    if (aggOp !== "count") {
      aggIdx = resolveCol(args.aggregate?.column);
      if (aggIdx === null) {
        return {
          tool: "analyze_grn",
          error: `aggregate op "${aggOp}" needs a numeric "column".`,
          availableColumns: columns,
        };
      }
    }
  }

  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);

  // No grouping → raw rows (capped) so the model can list examples.
  if (groupCols.length === 0 && !aggOp) {
    return {
      tool: "analyze_grn",
      file: source.fileName,
      totalRows: rows.length,
      matched: matched.length,
      returnedRows: matched.slice(0, limit).map((cells) =>
        Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ""]))
      ),
      truncated: matched.length > limit,
    };
  }

  // Group / aggregate.
  const groups = new Map<string, { count: number; value: number; n: number }>();
  for (const cells of matched) {
    const key = groupCols.map((i) => String(cells[i] ?? "").trim() || "(blank)").join(" | ");
    let g = groups.get(key);
    if (!g) {
      g = { count: 0, value: 0, n: 0 };
      groups.set(key, g);
    }
    g.count++;
    if (aggIdx !== null) {
      const num = toNumber(String(cells[aggIdx] ?? ""));
      if (!Number.isNaN(num)) {
        g.value += num;
        g.n++;
      }
    }
  }

  let entries = [...groups.entries()];
  // +1 ascending / -1 descending — the DEFAULT is "top N" = descending.
  const dirMul = String(args.sortBy?.dir ?? "desc").toLowerCase() === "asc" ? 1 : -1;
  const sortBy = String(args.sortBy?.by ?? (aggOp && aggOp !== "count" ? "value" : "count"));
  const metric = (g: { count: number; value: number; n: number }) =>
    aggOp === "sum" || aggOp === "min" || aggOp === "max"
      ? g.value
      : aggOp === "avg"
        ? g.n
          ? g.value / g.n
          : 0
        : g.count;
  if (sortBy === "group") {
    entries.sort((a, b) => dirMul * a[0].localeCompare(b[0]));
  } else {
    entries.sort((a, b) => dirMul * (metric(a[1]) - metric(b[1])) || a[0].localeCompare(b[0]));
  }

  const outGroups = entries.slice(0, limit).map(([key, g]) => {
    const base: Record<string, unknown> = groupCols.reduce(
      (acc, colIdx, gi) => {
        acc[columns[colIdx]] = key.split(" | ")[gi];
        return acc;
      },
      {} as Record<string, unknown>
    );
    base.count = g.count;
    if (aggOp === "sum") base[`${aggOp}(${args.aggregate?.column})`] = Math.round(g.value * 100) / 100;
    if (aggOp === "avg") base[`avg(${args.aggregate?.column})`] = g.n ? Math.round((g.value / g.n) * 100) / 100 : null;
    if (aggOp === "count") base["count"] = g.count;
    return base;
  });

  // min/max need a real pass over values.
  if (aggOp === "min" || aggOp === "max") {
    let best: number | null = null;
    for (const cells of matched) {
      const num = toNumber(String(cells[aggIdx!] ?? ""));
      if (Number.isNaN(num)) continue;
      if (best === null || (aggOp === "min" ? num < best : num > best)) best = num;
    }
    return {
      tool: "analyze_grn",
      file: source.fileName,
      totalRows: rows.length,
      matched: matched.length,
      result: { [`${aggOp}(${args.aggregate?.column})`]: best },
    };
  }

  return {
    tool: "analyze_grn",
    file: source.fileName,
    totalRows: rows.length,
    matched: matched.length,
    groups: outGroups,
    truncated: entries.length > limit,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher used by the widget
// ---------------------------------------------------------------------------

export type AiToolContext = {
  /** Enriched rows of the page's year (already in memory). */
  paymentsRows?: PaymentRowLite[];
  /** Loads + enriches other academic years on demand (whole-database access). */
  loadPaymentsRows?: (years: string[]) => Promise<PaymentRowLite[]>;
  grn?: GrnSource | null;
  /** Fetches the last saved GRN snapshot from the database (works on any page). */
  loadGrn?: () => Promise<GrnSource | null>;
};

export async function executeAiTool(
  name: string,
  args: unknown,
  ctx: AiToolContext
): Promise<Record<string, unknown>> {
  try {
    if (name === "query_payments") {
      const a = (args ?? {}) as PaymentsArgs;
      let rows: PaymentRowLite[] = ctx.paymentsRows ?? [];
      // Cross-year / whole-database question → load the requested years first
      // (memory → IndexedDB cache → network, via the historic provider).
      if ((a.allYears || (a.sessionYears && a.sessionYears.length > 0)) && ctx.loadPaymentsRows) {
        const requested = a.allYears ? [...ALL_SESSION_YEARS] : normList(a.sessionYears) ?? [];
        const loaded = await ctx.loadPaymentsRows(requested);
        if (loaded.length > 0) rows = loaded;
      }
      if (!rows || rows.length === 0) {
        return {
          error:
            "No payment rows are available. The user may still be loading the data — suggest trying again, or narrow to a specific academic year.",
        };
      }
      return executeQueryPayments(rows, a);
    }
    if (name === "analyze_grn") {
      let grn = ctx.grn ?? null;
      // Not on the Pending GRN page? The last uploaded file is saved in the
      // database — fetch it and analyse that.
      if (!grn && ctx.loadGrn) grn = await ctx.loadGrn();
      if (!grn) {
        return {
          error:
            "No GRN file is available. Ask the user to upload one on the Pending GRN page — it is then saved to the database automatically.",
        };
      }
      return executeAnalyzeGrn(grn, (args ?? {}) as GrnArgs);
    }
    return { error: `Unknown tool "${name}".` };
  } catch (e) {
    return { error: `Tool failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Page source descriptor (what the server model is told about the page)
// ---------------------------------------------------------------------------

export type AiPageSource =
  | {
      kind: "payments";
      page: string;
      pageTitle: string;
      year: string;
      rowCount: number;
      /** All grade values present in this year's rows (exact spellings). */
      grades: string[];
      /** Months (yyyy-mm) that actually have first_paid_date data. */
      dataMonths: string[];
      /** Academic years the whole-database tool can query. */
      yearsAvailable: string[];
      zones: string[];
      zoneByBranch: Record<string, string>;
      icseRules: Array<{ branch: string; grade: string }>;
    }
  | {
      kind: "grn_file";
      page: string;
      pageTitle: string;
      fileName: string;
      rowCount: number;
      columns: string[];
    }
  | { kind: "none"; page: string; pageTitle: string };

export function buildPageSource(opts: {
  page: string;
  pageTitle: string;
  historicRows?: Array<{ branch: string; grade: string; first_paid_date?: string }>;
  year?: string;
  yearsAvailable?: string[];
  zoneByBranch?: Map<string, string>;
  icseRules?: Array<{ branch: string; grade: string }>;
  grn?: GrnSource | null;
}): AiPageSource {
  const { page, pageTitle } = opts;
  if (page === "historic-report") {
    const zoneByBranch = opts.zoneByBranch ?? new Map();
    const zones = [...new Set([...zoneByBranch.values()].filter(Boolean))].sort();
    // Value domains straight from the live rows, so the interpreter can map
    // "6th" → the exact grade spelling and "last month" → a month with data.
    const grades = [...new Set((opts.historicRows ?? []).map((r) => r.grade).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, undefined, { numeric: true })
    );
    const dataMonths = [
      ...new Set(
        (opts.historicRows ?? [])
          .map((r) => (r.first_paid_date ?? "").slice(0, 7))
          .filter((m) => /^\d{4}-\d{2}$/.test(m))
      ),
    ].sort();
    return {
      kind: "payments",
      page,
      pageTitle,
      year: opts.year ?? "",
      rowCount: opts.historicRows?.length ?? 0,
      grades,
      dataMonths,
      yearsAvailable: opts.yearsAvailable ?? [],
      zones,
      zoneByBranch: Object.fromEntries(zoneByBranch),
      icseRules: opts.icseRules ?? [],
    };
  }
  if (page === "pending-grn" && opts.grn) {
    return {
      kind: "grn_file",
      page,
      pageTitle,
      fileName: opts.grn.fileName,
      rowCount: opts.grn.rowCount,
      columns: opts.grn.columns,
    };
  }
  return { kind: "none", page, pageTitle };
}
