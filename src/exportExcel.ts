import type * as XLSXNS from "xlsx-js-style";
import type { PreparedReport } from "./prepareReport";

const NAVY = "12325E";
const LIGHT_BLUE = "E3ECF8";

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

function agingStyle(days: number): CellStyle {
  const map: Record<string, { font: string; bg: string }> = {
    red: { font: "C4271F", bg: "FDE8E7" },
    amber: { font: "9A5B00", bg: "FFF3D6" },
    green: { font: "157A51", bg: "E4F5EC" },
  };
  const key = days > 30 ? "red" : days > 15 ? "amber" : "green";
  const c = map[key];
  return {
    font: { bold: true, color: { rgb: c.font }, sz: 11 },
    fill: { patternType: "solid", fgColor: { rgb: c.bg } },
    alignment: { horizontal: "center" },
  };
}

const totalStyle: CellStyle = {
  font: { bold: true, color: { rgb: NAVY }, sz: 11 },
  fill: { patternType: "solid", fgColor: { rgb: LIGHT_BLUE } },
  border: {
    top: { style: "thin", color: { rgb: "C3CFDD" } },
    bottom: { style: "thin", color: { rgb: "C3CFDD" } },
    left: { style: "thin", color: { rgb: "C3CFDD" } },
    right: { style: "thin", color: { rgb: "C3CFDD" } },
  },
};

const zebraFill: CellStyle = {
  fill: { patternType: "solid", fgColor: { rgb: "F8FAFD" } },
};

/**
 * Lazy module ref: set on first export, reused afterwards. Using a value
 * import at top level would pull xlsx-js-style into the initial bundle.
 */
type XlsxModule = typeof import("xlsx-js-style");
let xlsxMod: XlsxModule | null = null;

function styleRange(
  ws: XLSXNS.WorkSheet,
  range: { s: { r: number; c: number }; e: { r: number; c: number } },
  apply: (cell: XLSXNS.CellObject, r: number, c: number) => void
) {
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const mod = xlsxMod as XlsxModule; // caller loads it before styling
      const addr = mod.utils.encode_cell({ r, c });
      const cell = (ws[addr] as XLSXNS.CellObject) ?? (ws[addr] = { t: "s", v: "" });
      apply(cell, r, c);
    }
  }
}

/**
 * Export is async so the heavy xlsx-js-style library (~400 KB gzipped) is
 * code-split and only downloaded when the user actually exports Excel.
 */
export async function exportPreparedExcel(prep: PreparedReport, fileLabel: string) {
  const XLSX = await import("xlsx-js-style");
  xlsxMod = XLSX;
  const wb = XLSX.utils.book_new();

  // ---------- Sheet 1: Snapshot (pivot) ----------
  const snapRows: (string | number)[][] = [
    ["ZBH", "Plant Name", "Total Pending GRN", "Oldest GRN Aging"],
    ...prep.plantRows.map((r) => [r.zbh, r.plant, r.totalPendingGrn, r.oldestAging]),
    ["", "Total", prep.overallDistinctDocs, ""],
  ];
  const wsSnap = XLSX.utils.aoa_to_sheet(snapRows);

  // Column widths
  wsSnap["!cols"] = [{ wch: 16 }, { wch: 34 }, { wch: 20 }, { wch: 20 }];

  const lastDataRow = prep.plantRows.length; // header is row 0
  const LAST_COL = 3; // ZBH | Plant Name | Total Pending GRN | Oldest GRN Aging
  styleRange(wsSnap, { s: { r: 0, c: 0 }, e: { r: 0, c: LAST_COL } }, (cell) => {
    cell.s = headerStyle;
  });
  styleRange(wsSnap, { s: { r: 1, c: 0 }, e: { r: lastDataRow, c: LAST_COL } }, (cell, r) => {
    if (r % 2 === 1) cell.s = { ...(cell.s ?? {}), ...zebraFill };
  });
  styleRange(wsSnap, { s: { r: 1, c: LAST_COL }, e: { r: lastDataRow, c: LAST_COL } }, (cell, r) => {
    const days = Number(snapRows[r]?.[LAST_COL] ?? 0);
    cell.s = agingStyle(days);
  });
  styleRange(
    wsSnap,
    { s: { r: lastDataRow + 1, c: 0 }, e: { r: lastDataRow + 1, c: LAST_COL } },
    (cell) => {
      cell.s = totalStyle;
    }
  );

  XLSX.utils.book_append_sheet(wb, wsSnap, "Snapshot");

  // ---------- Sheet 2: Data (final filtered rows, with ZBH as first column) ----------
  const dataColumns = prep.filteredRowZbh
    ? ["ZBH", ...prep.columnsForExport]
    : prep.columnsForExport;
  const dataRows: (string | number)[][] = prep.filteredRows.map((r, i) => {
    const cells = r.cells.map((c) => (typeof c === "number" ? c : String(c)));
    return prep.filteredRowZbh ? [prep.filteredRowZbh[i], ...cells] : cells;
  });
  const wsData = XLSX.utils.aoa_to_sheet([dataColumns, ...dataRows]);

  wsData["!cols"] = dataColumns.map((c, i) => ({
    wch: i === 0 && prep.filteredRowZbh ? 16 : Math.min(Math.max(c.length + 4, 12), 40),
  }));

  styleRange(wsData, { s: { r: 0, c: 0 }, e: { r: 0, c: dataColumns.length - 1 } }, (cell) => {
    cell.s = headerStyle;
  });
  styleRange(wsData, { s: { r: 1, c: 0 }, e: { r: dataRows.length, c: dataColumns.length - 1 } }, (cell, r) => {
    if (r % 2 === 1) cell.s = zebraFill;
  });

  XLSX.utils.book_append_sheet(wb, wsData, "Data");

  const fileName = `PendingGRN_Report_${prep.paramsUsed.startDate}_to_${prep.paramsUsed.endDate}_${fileLabel}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
