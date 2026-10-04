export type BranchZbhMapping = {
  zone: string;
  branchSap: string;
  branchEduvate: string;
  zbh: string;
};

export type NavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  keywords?: string[];
};

export type FileKind = "csv" | "xlsx" | "xls";

export type ParsedReport = {
  fileName: string;
  fileSize: number;
  sheetName: string;
  uploadedAt: Date;
  columns: string[];
  rows: ReportRow[];
};

export type ReportRow = {
  id: number;
  cells: (string | number)[];
};

export type HistoricFetchLog = {
  report_key: string;
  last_fetched_at: string | null;
  last_report_date: string | null;
  last_row_count: number | null;
  last_status: string;
  last_error: string | null;
};

export type PaymentReportRow = {
  id: number;
  branch: string;
  enrollment_code: string;
  grade: string;
  student_type: string;
  first_paid_date: string;
  fetched_at: string;
  /** Derived at fetch time and stored; older rows may be null. */
  session_year?: string;
  zone?: string | null;
  segment?: string | null;
};

/** Case-insensitive trimmed lookup: Branch (Eduvate) -> mapping row. */
export function findZoneByBranchEduvate(
  mapping: BranchZbhMapping[],
  branch: string
): BranchZbhMapping | null {
  const target = branch.trim().toLowerCase();
  if (!target) return null;
  return (
    mapping.find((m) => (m.branchEduvate || "").trim().toLowerCase() === target) ?? null
  );
}
