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

export type HistoricTpndRow = {
  id: number;
  report_date: string;
  branch_name: string;
  paid_date: string | null;
  grade: string;
  enrollment_code: string;
  permanent_status: string;
  extra: Record<string, string> | null;
  fetched_at: string;
};

export type HistoricStoreRow = {
  id: number;
  report_date: string;
  branch: string;
  paid_date: string | null;
  enrollment_code: string;
  grade: string;
  section: string;
  kit_name: string;
  quantity: number;
  amount: number;
  total: number;
  receipt_no: string | null;
  extra: Record<string, string> | null;
  fetched_at: string;
};
