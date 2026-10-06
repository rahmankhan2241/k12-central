import type * as XLSXNS from "xlsx-js-style";

const NAVY = "12325E";

type CellStyle = XLSXNS.CellStyle;

const headerStyle: CellStyle = {
  font: { bold: true, color: { rgb: "DCE8F7" }, sz: 11 },
  fill: { patternType: "solid", fgColor: { rgb: NAVY } },
  alignment: { horizontal: "left", vertical: "center" },
  border: {
    top: { style: "thin", color: { rgb: NAVY } },
    bottom: { style: "thin", color: { rgb: NAVY } },
    left: { style: "thin", color: { rgb: NAVY } },
    right: { style: "thin", color: { rgb: NAVY } },
  },
};

// Shared style objects (not per-cell copies) — the full export has ~95k rows.
const zebraFill: CellStyle = {
  fill: { patternType: "solid", fgColor: { rgb: "F8FAFD" } },
};

const totalStyle: CellStyle = { font: { bold: true } };

const COLUMNS = ["Zone", "Branch", "Enrollment Code", "Grade", "Student Type", "Segment", "First Paid Date"];

const COL_WIDTHS = [{ wch: 18 }, { wch: 32 }, { wch: 18 }, { wch: 14 }, { wch: 13 }, { wch: 10 }, { wch: 16 }];

const SUMMARY_COLUMNS = ["Zone", "Branch", "Grade", "Total Paid"];

const SUMMARY_COL_WIDTHS = [{ wch: 18 }, { wch: 32 }, { wch: 14 }, { wch: 12 }];

export type PaymentExportRow = {
  zone: string;
  branch: string;
  enrollment_code: string;
  grade: string;
  student_type: string;
  segment: string;
  first_paid_date: string;
};

export type PaidSummaryRow = {
  zone: string;
  branch: string;
  grade: string;
  paid: number;
};

function todayLabel(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Zone | Branch | Grade | Total Paid roll-up of the exported rows — one row
 * per zone-branch-grade combination, counting paid students (one per ERP).
 */
export function summarizeByZoneBranchGrade(data: PaymentExportRow[]): PaidSummaryRow[] {
  const map = new Map<string, PaidSummaryRow>();
  for (const r of data) {
    const zone = r.zone || "(No zone)";
    const grade = r.grade || "(No grade)";
    const key = `${zone}\u0000${r.branch}\u0000${grade}`;
    const row = map.get(key);
    if (row) row.paid += 1;
    else map.set(key, { zone, branch: r.branch, grade, paid: 1 });
  }
  return [...map.values()].sort(
    (a, b) =>
      a.zone.localeCompare(b.zone) ||
      a.branch.localeCompare(b.branch) ||
      a.grade.localeCompare(b.grade, undefined, { numeric: true })
  );
}

/**
 * Export is async so the heavy xlsx-js-style library (~400 KB gzipped) is
 * code-split and only downloaded when the user actually exports Excel.
 * The workbook has TWO sheets:
 *  1. "Payment Report" — ERP-wise detailed rows.
 *  2. "Zone Branch Grade Summary" — Zone | Branch | Grade | Total Paid roll-up
 *     of exactly the rows in sheet 1, ending with a bold Total row.
 * mode is only used for the file name — pass the exact rows to export.
 */
export async function exportPaymentExcel(
  data: PaymentExportRow[],
  mode: "filtered" | "full"
): Promise<string> {
  const XLSX = await import("xlsx-js-style");

  // ---- Sheet 1: ERP-wise detailed data ----
  const rows: (string | number)[][] = data.map((r) => [
    r.zone,
    r.branch,
    r.enrollment_code,
    r.grade,
    r.student_type,
    r.segment,
    r.first_paid_date,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows]);
  ws["!cols"] = COL_WIDTHS;
  ws["!autofilter"] = { ref: `A1:G${rows.length + 1}` };

  // Header + zebra (shared style refs keep the 95k-row export light).
  for (let c = 0; c < COLUMNS.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = (ws[addr] as XLSXNS.CellObject) ?? (ws[addr] = { t: "s", v: "" });
    cell.s = headerStyle;
  }
  for (let r = 1; r <= rows.length; r++) {
    if (r % 2 === 1) continue; // odd data rows stay default white
    for (let c = 0; c < COLUMNS.length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = (ws[addr] as XLSXNS.CellObject) ?? (ws[addr] = { t: "s", v: "" });
      cell.s = zebraFill;
    }
  }

  // ---- Sheet 2: Zone | Branch | Grade | Total Paid summary ----
  const summary = summarizeByZoneBranchGrade(data);
  const summaryAoa: (string | number)[][] = [
    SUMMARY_COLUMNS,
    ...summary.map((s) => [s.zone, s.branch, s.grade, s.paid]),
  ];
  if (summary.length > 0) {
    summaryAoa.push(["Total", "", "", summary.reduce((n, s) => n + s.paid, 0)]);
  }
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
  wsSummary["!cols"] = SUMMARY_COL_WIDTHS;
  if (summary.length > 0) {
    wsSummary["!autofilter"] = { ref: `A1:D${summary.length + 1}` };
  }
  for (let c = 0; c < SUMMARY_COLUMNS.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = (wsSummary[addr] as XLSXNS.CellObject) ?? (wsSummary[addr] = { t: "s", v: "" });
    cell.s = headerStyle;
  }
  for (let r = 1; r <= summary.length; r++) {
    if (r % 2 === 1) continue;
    for (let c = 0; c < SUMMARY_COLUMNS.length; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = (wsSummary[addr] as XLSXNS.CellObject) ?? (wsSummary[addr] = { t: "s", v: "" });
      cell.s = zebraFill;
    }
  }
  if (summary.length > 0) {
    const tr = summary.length + 1;
    for (let c = 0; c < SUMMARY_COLUMNS.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: tr, c });
      const cell = (wsSummary[addr] as XLSXNS.CellObject) ?? (wsSummary[addr] = { t: "s", v: "" });
      cell.s = totalStyle;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Payment Report");
  XLSX.utils.book_append_sheet(wb, wsSummary, "Zone Branch Grade Summary");

  const fileName = `Payment_Report_${todayLabel()}_${mode}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}
