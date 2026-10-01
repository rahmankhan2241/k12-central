/**
 * PO Tracking helpers — parse the uploaded PO Excel/CSV and read/write the
 * po_rows table in Supabase.
 *
 * Expected upload format (headers, case/space tolerant):
 *   PO Date | Category | Material Name | SKU Code | Existing Stock | PO Qty
 */
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";

export type PoRow = {
  id: number;
  po_date: string;
  category: string;
  material_name: string;
  sku_code: string;
  existing_stock: number;
  po_qty: number;
  uploaded_at?: string;
  updated_at?: string;
};

export type PoNewRow = Omit<PoRow, "id" | "uploaded_at" | "updated_at">;

const HEADER_ALIASES: Record<string, keyof PoNewRow> = {
  "podate": "po_date",
  "date": "po_date",
  "category": "category",
  "materialname": "material_name",
  "material": "material_name",
  "item": "material_name",
  "skucode": "sku_code",
  "sku": "sku_code",
  "code": "sku_code",
  "existingstock": "existing_stock",
  "stock": "existing_stock",
  "poqty": "po_qty",
  "qty": "po_qty",
  "quantity": "po_qty",
};

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").replace(/[,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Excel date cells arrive as a serial number — convert to yyyy-mm-dd text. */
function toPoDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number" && v > 20000 && v < 60000) {
    // Excel serial date (days since 1899-12-30).
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const dt = new Date(ms);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  return String(v ?? "").trim();
}

export type PoParseResult = {
  rows: PoNewRow[];
  skipped: number;
  columnsFound: string[];
};

/** Parse an uploaded PO workbook; rows missing every key field are skipped. */
export async function parsePoWorkbook(file: File): Promise<PoParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], skipped: 0, columnsFound: [] };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  if (matrix.length === 0) return { rows: [], skipped: 0, columnsFound: [] };

  // Header row: first row that maps at least 2 known columns.
  let headerIdx = -1;
  let colMap: Record<number, keyof PoNewRow> = {};
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const cells = (matrix[i] ?? []).map((c) => normHeader(String(c)));
    const map: Record<number, keyof PoNewRow> = {};
    cells.forEach((c, idx) => {
      const field = HEADER_ALIASES[c];
      if (field && !Object.values(map).includes(field)) map[idx] = field;
    });
    if (Object.keys(map).length >= 2) {
      headerIdx = i;
      colMap = map;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "Could not find the PO headers (PO Date, Category, Material Name, SKU Code, Existing Stock, PO Qty) in the first sheet."
    );
  }

  const rows: PoNewRow[] = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const raw = matrix[i] ?? [];
    if (raw.every((c) => String(c ?? "").trim() === "")) continue;
    const row: PoNewRow = {
      po_date: "",
      category: "",
      material_name: "",
      sku_code: "",
      existing_stock: 0,
      po_qty: 0,
    };
    for (const [idxStr, field] of Object.entries(colMap)) {
      const v = raw[Number(idxStr)];
      if (field === "po_date") row.po_date = toPoDate(v);
      else if (field === "existing_stock") row.existing_stock = toNum(v);
      else if (field === "po_qty") row.po_qty = toNum(v);
      else row[field] = String(v ?? "").trim();
    }
    // Skip rows with no material/sku/category at all.
    if (!row.sku_code && !row.material_name && !row.category) {
      skipped += 1;
      continue;
    }
    rows.push(row);
  }
  return { rows, skipped, columnsFound: Object.values(colMap) };
}

// ---------------------------------------------------------------------------
// Supabase reads/writes
// ---------------------------------------------------------------------------

export async function loadPoRows(): Promise<PoRow[]> {
  const PAGE = 1000;
  const all: PoRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("po_rows")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as PoRow[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

/** Append rows (Append mode) — headers already stripped by the parser. */
export async function appendPoRows(rows: PoNewRow[]): Promise<number> {
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from("po_rows").insert(rows.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    inserted += Math.min(CHUNK, rows.length - i);
  }
  return inserted;
}

/** Replace mode: delete EVERYTHING, then insert the fresh upload. */
export async function replacePoRows(rows: PoNewRow[]): Promise<number> {
  const { error: delErr } = await supabase.from("po_rows").delete().neq("id", 0);
  if (delErr) throw new Error(delErr.message);
  return appendPoRows(rows);
}

export async function updatePoRow(id: number, patch: Partial<PoNewRow>): Promise<void> {
  const { error } = await supabase.from("po_rows").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
