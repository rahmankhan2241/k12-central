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

const COLUMNS = ["Zone", "Branch", "Enrollment Code", "Grade", "Student Type", "Segment", "First Paid Date"];

const COL_WIDTHS = [{ wch: 18 }, { wch: 32 }, { wch: 18 }, { wch: 14 }, { wch: 13 }, { wch: 10 }, { wch: 16 }];

export type PaymentExportRow = {
  zone: string;
  branch: string;
  enrollment_code: string;
  grade: string;
  student_type: string;
  segment: string;
  first_paid_date: string;
};

function todayLabel(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Export is async so the heavy xlsx-js-style library (~400 KB gzipped) is
 * code-split and only downloaded when the user actually exports Excel.
 * mode is only used for the file name — pass the exact rows to export.
 */
export async function exportPaymentExcel(
  data: PaymentExportRow[],
  mode: "filtered" | "full"
): Promise<string> {
  const XLSX = await import("xlsx-js-style");
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
  ws["!autofilter"] = { ref: `A1:F${rows.length + 1}` };

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

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Payment Report");

  const fileName = `Payment_Report_${todayLabel()}_${mode}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}
