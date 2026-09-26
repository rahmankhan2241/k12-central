import type { FileKind } from "./types";

const ACCEPTED: FileKind[] = ["csv", "xlsx", "xls"];
export const FILE_ACCEPT = ".csv,.xlsx,.xls";

export function getExtension(name: string): FileKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (ACCEPTED as string[]).includes(ext) ? (ext as FileKind) : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
