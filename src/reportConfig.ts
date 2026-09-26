export const DEFAULT_GRN_COLUMNS: string[] = [
  "GRN Number",
  "PO Number",
  "Vendor Name",
  "Plant",
  "Material Code",
  "Material Description",
  "PO Qty",
  "Received Qty",
  "Pending Qty",
  "GRN Date",
  "Status",
];

export function normalizeColumn(name: string): string {
  return name.trim().toLowerCase();
}

/** Expected columns that are NOT present in the uploaded file (case-insensitive). */
export function findMissingColumns(expected: string[], fileColumns: string[]): string[] {
  const fileSet = new Set(fileColumns.map(normalizeColumn));
  return expected.filter((c) => !fileSet.has(normalizeColumn(c)));
}

/** File columns that are NOT part of the expected mapping (case-insensitive). */
export function findExtraColumns(expected: string[], fileColumns: string[]): string[] {
  const expectedSet = new Set(expected.map(normalizeColumn));
  return fileColumns.filter((c) => !expectedSet.has(normalizeColumn(c)));
}
