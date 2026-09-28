import type { BranchZbhMapping, ParsedReport, ReportRow } from "./types";
import type { ReportParams } from "./useReportParams";

export type PlantPivotRow = {
  zbh: string;
  plant: string;
  totalPendingGrn: number;
  oldestAging: number;
};

export type PreparedReport = {
  generatedAt: Date;
  paramsUsed: ReportParams;
  funnel: {
    raw: number;
    afterZeroGr: number;
    afterDate: number;
    afterTaproot: number;
    afterSspl: number;
  };
  finalRowCount: number;
  overallDistinctDocs: number;
  plantRows: PlantPivotRow[];
  filteredRows: ReportRow[];
  /** ZBH per filtered row (same order as filteredRows); null when no Plant Name column. */
  filteredRowZbh: string[] | null;
  columnsForExport: string[];
  warnings: string[];
};

/** Locate a column index by name, case-insensitive. */
export function findColumnIndex(columns: string[], name: string): number {
  const target = name.trim().toLowerCase();
  return columns.findIndex((c) => c.trim().toLowerCase() === target);
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Convert an Excel serial date number (days since 1899-12-30) to UTC parts. */
function excelSerialToParts(serial: number): { y: number; m: number; d: number } {
  const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * Parse a date from common RAW formats:
 * - ISO (yyyy-mm-dd)
 * - dd/mm/yyyy, mm/dd/yyyy, dd.mm.yyyy (ambiguous = day-first, India)
 * - dd-MMM-yyyy / MMM dd yyyy (05-Sep-2026, Sep 5 2026)
 * - Excel serial numbers as plain text (45637) — common when the cell
 *   has no date format applied in the source system
 * Returns yyyy, mm, dd as UTC-safe parts, or null.
 */
export function parseDateParts(value: string): { y: number; m: number; d: number } | null {
  const s = value.trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    return { y: +m[1], m: +m[2], d: +m[3] };
  }
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/))) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    let d: number;
    let mo: number;
    if (a > 12 && b <= 12) {
      d = a; mo = b; // dd/mm/yyyy
    } else if (b > 12 && a <= 12) {
      mo = a; d = b; // mm/dd/yyyy
    } else {
      d = a; mo = b; // ambiguous -> day-first (India)
    }
    return { y, m: mo, d };
  }
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,4})\.?[-\s](\d{2,4})$/))) {
    const mo = MONTH_NAMES[m[2].toLowerCase()];
    if (mo) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], m: mo, d: +m[1] };
  }
  if ((m = s.match(/^([A-Za-z]{3,4})\.?[-\s](\d{1,2}),?[-\s](\d{2,4})$/))) {
    const mo = MONTH_NAMES[m[1].toLowerCase()];
    if (mo) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], m: mo, d: +m[2] };
  }
  // Excel serial date stored as a plain number (e.g. 45637)
  if (/^\d{4,6}$/.test(s)) {
    const serial = Number(s);
    if (serial >= 20000 && serial <= 80000) {
      return excelSerialToParts(serial);
    }
  }
  return null;
}

function utcMidnight(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d);
}

function todayUtcMidnight(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Aging = today - (posting date + 7 days), in whole days. */
export function computeAging(postingDateStr: string, todayMs: number): number | null {
  const parts = parseDateParts(postingDateStr);
  if (!parts) return null;
  const deliveryMs = utcMidnight(parts.y, parts.m, parts.d) + 7 * 86400000;
  return Math.floor((todayMs - deliveryMs) / 86400000);
}

function numericValue(cell: string | number): number {
  const s = String(cell).replace(/[,\s]/g, "");
  if (s === "" || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function prepareReport(
  report: ParsedReport,
  params: ReportParams,
  branchZbhMapping: BranchZbhMapping[] = []
): PreparedReport {
  const warnings: string[] = [];
  const todayMs = todayUtcMidnight();

  // Plant Name → ZBH lookup against the saved Branch & ZBH Mapping.
  // Match on Branch (SAP) — NOT Branch (Eduvate).
  const zbhByBranchSap = new Map<string, string>();
  for (const m of branchZbhMapping) {
    if (m && typeof m.branchSap === "string" && m.branchSap.trim()) {
      zbhByBranchSap.set(m.branchSap.trim().toLowerCase(), String(m.zbh ?? "").trim());
    }
  }
  const lookupZbh = (plant: string): string =>
    zbhByBranchSap.get(plant.trim().toLowerCase()) ?? "(Unmapped)";

  const grIdx = findColumnIndex(report.columns, "Material Document (GR)");
  const postingIdx = findColumnIndex(report.columns, "Posting Date (GI)");
  const plantIdx = findColumnIndex(report.columns, "Plant Name");
  const deliveryIdx = findColumnIndex(report.columns, "Delivery Document (GI)");

  if (grIdx === -1) warnings.push("Column “Material Document (GR)” not found — zero-GR filter skipped.");
  if (postingIdx === -1) warnings.push("Column “Posting Date (GI)” not found — date filter and aging skipped.");
  if (plantIdx === -1) warnings.push("Column “Plant Name” not found — ZBH/Taproot/SSPL filters skipped.");
  if (deliveryIdx === -1) warnings.push("Column “Delivery Document (GI)” not found — pending count uses row count.");

  const startParts = parseDateParts(params.startDate);
  const startMs = startParts
    ? utcMidnight(startParts.y, startParts.m, startParts.d)
    : Number.MIN_SAFE_INTEGER;
  const endParts = parseDateParts(params.endDate);
  const endMs = endParts
    ? utcMidnight(endParts.y, endParts.m, endParts.d) + 86399999
    : Number.MAX_SAFE_INTEGER;

  let rows = report.rows;
  const funnelRaw = rows.length;

  // 1) Keep only rows where Material Document (GR) == 0 (blank/non-numeric counts as 0)
  if (grIdx !== -1) {
    rows = rows.filter((r) => numericValue(r.cells[grIdx] as string | number) === 0);
  }
  const afterZeroGr = rows.length;

  // 2) Posting Date within [start, end] inclusive
  if (postingIdx !== -1) {
    rows = rows.filter((r) => {
      const parts = parseDateParts(String(r.cells[postingIdx]));
      if (!parts) return false;
      const ms = utcMidnight(parts.y, parts.m, parts.d);
      return ms >= startMs && ms <= endMs;
    });
  }
  const afterDate = rows.length;

  // 3/4) Taproot filter on the row's ZBH (via the Branch & ZBH Mapping lookup
  // on Plant Name) — contains "taproot" case-insensitive, e.g. "Arun (Taproot)".
  if (plantIdx !== -1) {
    if (params.taproot) {
      rows = rows.filter((r) =>
        lookupZbh(String(r.cells[plantIdx] ?? "").trim() || "(Blank)")
          .toLowerCase()
          .includes("taproot")
      );
    } else {
      rows = rows.filter(
        (r) =>
          !lookupZbh(String(r.cells[plantIdx] ?? "").trim() || "(Blank)")
            .toLowerCase()
            .includes("taproot")
      );
    }
  }
  const afterTaproot = rows.length;

  // 5) Always exclude Plant Name containing "sspl" (case-insensitive, anywhere)
  if (plantIdx !== -1) {
    rows = rows.filter(
      (r) => !String(r.cells[plantIdx]).toLowerCase().includes("sspl")
    );
  }
  const afterSspl = rows.length;

  // 7) Pivot by Plant Name: distinct count of Delivery Document (GI) + max aging
  const byPlant = new Map<string, { docs: Set<string>; maxAging: number }>();
  for (const r of rows) {
    const plant = String(r.cells[plantIdx] ?? "").trim() || "(Blank)";
    const doc = deliveryIdx !== -1 ? String(r.cells[deliveryIdx] ?? "").trim() : String(r.id);
    const aging =
      postingIdx !== -1 ? computeAging(String(r.cells[postingIdx]), todayMs) : null;
    let entry = byPlant.get(plant);
    if (!entry) {
      entry = { docs: new Set(), maxAging: 0 };
      byPlant.set(plant, entry);
    }
    if (doc) entry.docs.add(doc.toLowerCase());
    if (aging !== null && aging > entry.maxAging) entry.maxAging = aging;
  }

  const unmappedPlants: string[] = [];
  const plantRows: PlantPivotRow[] = Array.from(byPlant.entries())
    .map(([plant, { docs, maxAging }]) => {
      const zbh = lookupZbh(plant);
      if (zbh === "(Unmapped)") unmappedPlants.push(plant);
      return {
        zbh,
        plant,
        totalPendingGrn: docs.size,
        oldestAging: maxAging,
      };
    })
    // Sorted by Total Pending GRN descending; oldest aging breaks ties.
    .sort((a, b) => b.totalPendingGrn - a.totalPendingGrn || b.oldestAging - a.oldestAging);

  if (zbhByBranchSap.size === 0) {
    warnings.push(
      "Branch & ZBH Mapping is empty — ZBH shows “(Unmapped)”. Upload it in Settings → Pending GRN Related."
    );
  } else if (unmappedPlants.length > 0) {
    warnings.push(
      `${unmappedPlants.length} plant${unmappedPlants.length === 1 ? "" : "s"} not found in Branch & ZBH Mapping (matched on Branch (SAP)): ${unmappedPlants.join(", ")}.`
    );
  }

  const overallDocs = new Set<string>();
  for (const r of rows) {
    if (deliveryIdx !== -1) {
      const doc = String(r.cells[deliveryIdx] ?? "").trim();
      if (doc) overallDocs.add(doc.toLowerCase());
    }
  }

  // Per-row ZBH for the Data sheet export (same Branch (SAP) lookup as the pivot).
  const filteredRowZbh =
    plantIdx !== -1
      ? rows.map((r) => {
          const plant = String(r.cells[plantIdx] ?? "").trim() || "(Blank)";
          return lookupZbh(plant);
        })
      : null;

  return {
    generatedAt: new Date(),
    paramsUsed: params,
    funnel: { raw: funnelRaw, afterZeroGr, afterDate, afterTaproot, afterSspl },
    finalRowCount: rows.length,
    overallDistinctDocs: deliveryIdx !== -1 ? overallDocs.size : rows.length,
    plantRows,
    filteredRows: rows,
    filteredRowZbh,
    columnsForExport: report.columns,
    warnings,
  };
}
