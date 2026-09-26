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
