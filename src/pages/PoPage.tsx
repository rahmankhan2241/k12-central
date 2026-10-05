import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadPoRows,
  parsePoWorkbook,
  appendPoRows,
  replacePoRows,
  updatePoRow,
  deletePoRow,
  type PoRow,
} from "../poRows";
import MultiSelect from "../components/MultiSelect";
import {
  AlertIcon,
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  FileReportIcon,
  PencilIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from "../icons";

type UploadMode = "replace" | "append";

const COLUMNS: { key: keyof PoRow; label: string }[] = [
  { key: "po_date", label: "PO Date" },
  { key: "category", label: "Category" },
  { key: "material_name", label: "Material Name" },
  { key: "sku_code", label: "SKU Code" },
  { key: "edition", label: "Edition" },
  { key: "existing_stock", label: "Existing Stock" },
  { key: "po_qty", label: "PO Qty" },
];

const EDITABLE: (keyof PoRow)[] = [
  "po_date",
  "category",
  "material_name",
  "sku_code",
  "edition",
  "existing_stock",
  "po_qty",
];

function fmtNum(n: number): string {
  return n.toLocaleString("en-IN");
}

/** Random confirmation code shown to the user for a full-delete upload. */
function makeConfirmCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function PoPage() {
  const [rows, setRows] = useState<PoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string[]>([]);

  // Upload flow
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<UploadMode | null>(null);
  const [parsedCount, setParsedCount] = useState<number | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false); // step 2 warning
  const [confirmCode, setConfirmCode] = useState(""); // random code to type
  const [typedCode, setTypedCode] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadDone, setUploadDone] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Edit flow
  const [editId, setEditId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<PoRow>>({});
  const [editConfirm, setEditConfirm] = useState(false); // confirmation before applying
  const [savingEdit, setSavingEdit] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  // Delete flow: pick row → confirmation → permanent delete in Supabase
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rowNotice, setRowNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await loadPoRows();
        if (alive) setRows(data);
      } catch (e) {
        if (alive)
          setLoadError(
            e instanceof Error
              ? e.message
              : "Could not load PO data. If this says po_rows does not exist, run scripts/migration-po-rows.sql in Supabase first."
          );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const categoryOptions = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && category.length === 0) return rows;
    return rows.filter((r) => {
      if (category.length > 0 && !category.includes(r.category)) return false;
      if (!q) return true;
      return (
        r.sku_code.toLowerCase().includes(q) ||
        r.material_name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
      );
    });
  }, [rows, search, category]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, r) => ({
          stock: acc.stock + (r.existing_stock || 0),
          qty: acc.qty + (r.po_qty || 0),
        }),
        { stock: 0, qty: 0 }
      ),
    [filtered]
  );

  // ------------------------------------------------------------------
  // Upload flow: pick file → pick mode → (replace: 2 warnings + code) → run
  // ------------------------------------------------------------------
  const onFilePicked = async (f: File | null) => {
    setUploadDone(null);
    setUploadError(null);
    setParseError(null);
    setParsedCount(null);
    setConfirmDelete(false);
    setConfirmCode("");
    setTypedCode("");
    if (!f) return;
    setPendingFile(f);
    try {
      const res = await parsePoWorkbook(f);
      setParsedCount(res.rows.length);
      if (res.skipped > 0) {
        setParseError(`${res.skipped} empty/unrecognised row(s) were skipped.`);
      }
    } catch (e) {
      setPendingFile(null);
      const msg = e instanceof Error ? e.message : String(e);
      setParseError(msg);
      setUploadError(msg);
    }
  };

  const chooseMode = (mode: UploadMode) => {
    setUploadMode(mode);
    if (mode === "replace") {
      setConfirmDelete(false); // show first warning next
      setConfirmCode(makeConfirmCode());
      setTypedCode("");
    } else {
      // Append has no destructive warnings — run it straight away.
      void runUpload("append");
    }
  };

  const runUpload = async (modeOverride?: UploadMode) => {
    const mode = modeOverride ?? uploadMode;
    if (!pendingFile || !mode) return;
    setUploading(true);
    setParseError(null);
    setUploadError(null);
    try {
      const res = await parsePoWorkbook(pendingFile);
      if (res.rows.length === 0) {
        throw new Error(
          "No usable data rows were found in this file. Check that the sheet has PO Date / Category / Material Name / SKU Code / Existing Stock / PO Qty columns with data below them."
        );
      }
      const done = mode === "replace" ? await replacePoRows(res.rows) : await appendPoRows(res.rows);
      const fresh = await loadPoRows();
      setRows(fresh);
      setUploadDone(
        `${mode === "replace" ? "New upload" : "Appended"}: ${done.toLocaleString("en-IN")} PO rows ${mode === "replace" ? "loaded" : "added"}. Database now holds ${fresh.length.toLocaleString("en-IN")} rows.`
      );
      resetUpload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setParseError(msg);
      setUploadError(msg);
      // Close the modal so the error banner is actually visible.
      resetUpload();
    } finally {
      setUploading(false);
    }
  };

  const resetUpload = () => {
    setPendingFile(null);
    setUploadMode(null);
    setParsedCount(null);
    setConfirmDelete(false);
    setConfirmCode("");
    setTypedCode("");
    if (fileRef.current) fileRef.current.value = "";
  };

  // ------------------------------------------------------------------
  // Edit flow: open editor → Save → confirmation → apply
  // ------------------------------------------------------------------
  const startEdit = (r: PoRow) => {
    setRowError(null);
    setRowNotice(null);
    setEditId(r.id);
    setEditDraft({
      po_date: r.po_date,
      category: r.category,
      material_name: r.material_name,
      sku_code: r.sku_code,
      edition: r.edition,
      existing_stock: r.existing_stock,
      po_qty: r.po_qty,
    });
    setEditConfirm(false);
  };

  const confirmSaveEdit = async () => {
    if (editId == null) return;
    setSavingEdit(true);
    setRowError(null);
    try {
      const patch: Partial<PoRow> = {};
      for (const k of EDITABLE) {
        const v = editDraft[k];
        if (v !== undefined && v !== null) (patch as Record<string, unknown>)[k] = v;
      }
      await updatePoRow(editId, patch);
      setRows((rs) => rs.map((r) => (r.id === editId ? { ...r, ...patch } : r)));
      setEditId(null);
      setEditDraft({});
      setEditConfirm(false);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEdit(false);
    }
  };

  // ------------------------------------------------------------------
  // Delete flow: click trash → confirmation → permanent delete in Supabase
  // ------------------------------------------------------------------
  const confirmDeleteRow = async () => {
    if (deleteId == null) return;
    setDeleting(true);
    setRowError(null);
    setRowNotice(null);
    try {
      await deletePoRow(deleteId);
      setRows((rs) => rs.filter((r) => r.id !== deleteId));
      setRowNotice("PO row deleted permanently from the database.");
      setDeleteId(null);
    } catch (e) {
      setRowError(e instanceof Error ? e.message : String(e));
      setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  const exportCsv = () => {
    const header = COLUMNS.map((c) => c.label).join(",");
    const lines = filtered.map((r) =>
      [
        r.po_date,
        r.category,
        r.material_name,
        r.sku_code,
        r.edition,
        String(r.existing_stock),
        String(r.po_qty),
      ]
        .map((v) => (String(v).includes(",") ? `"${String(v).replace(/"/g, '""')}"` : String(v)))
        .join(",")
    );
    const blob = new Blob(["\uFEFF" + header + "\n" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `po-tracking-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const hasTable = rows.length > 0;
  const deleteRow = deleteId == null ? null : rows.find((r) => r.id === deleteId) ?? null;

  return (
    <div className="po-page">
      <div className="page-head">
        <h1 className="page-title">
          <span className="title-chip">
            <FileReportIcon size={19} />
          </span>
          PO Tracking
        </h1>
        <p className="page-subtitle">
          Purchase orders by date, category, material and SKU — upload the PO Excel and track
          quantities against existing stock.
        </p>
      </div>

      {/* ------------------------------------------------ Upload bar */}
      <div className="card po-upload-bar">
        <div className="po-upload-info">
          <span className="po-upload-icon">
            <UploadIcon size={16} />
          </span>
          <div>
            <div className="po-upload-title">PO Excel</div>
            <div className="po-upload-sub">
              Format: PO Date | Category | Material Name | SKU Code | Edition (optional) |
              Existing Stock | PO Qty
              {rows.length > 0 && (
                <>
                  {" · "}
                  <strong>{rows.length.toLocaleString("en-IN")}</strong> rows in database
                </>
              )}
            </div>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: "none" }}
          onChange={(e) => void onFilePicked(e.target.files?.[0] ?? null)}
        />
        <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <UploadIcon size={14} />
          {uploading ? "Working…" : hasTable ? "Upload Excel" : "Upload PO Excel"}
        </button>
      </div>

      {loadError && (
        <div className="upload-error">
          <AlertIcon size={14} />
          {loadError}
        </div>
      )}

      {uploadDone && (
        <div className="upload-success">
          <CheckCircleIcon size={14} />
          {uploadDone}
        </div>
      )}

      {uploadError && (
        <div className="upload-error">
          <AlertIcon size={14} />
          <span>Upload failed: {uploadError}</span>
        </div>
      )}

      {/* ------------------------------------------------ Upload mode modal (step 1) */}
      {pendingFile && parsedCount != null && !uploadMode && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && resetUpload()}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Upload mode">
            <div className="modal-head">
              <h3>
                <UploadIcon size={16} />
                How should this file be added?
              </h3>
              <button className="modal-close" onClick={resetUpload} aria-label="Cancel upload">
                <CloseIcon size={15} />
              </button>
            </div>
            <div className="modal-body">
              <p className="param-note" style={{ margin: 0 }}>
                <strong>{pendingFile.name}</strong> parsed — {parsedCount.toLocaleString("en-IN")}{" "}
                data rows found. Choose the upload mode:
              </p>
              <div className="export-choice-grid">
                <button className="export-choice" onClick={() => chooseMode("replace")}>
                  <span className="export-choice-title">New Upload</span>
                  <span className="export-choice-sub">
                    Erases ALL existing PO data first — only this file's rows will remain
                  </span>
                </button>
                <button className="export-choice" onClick={() => chooseMode("append")}>
                  <span className="export-choice-title">Append Data</span>
                  <span className="export-choice-sub">
                    Adds these {parsedCount.toLocaleString("en-IN")} rows after the existing data
                    (headers ignored)
                  </span>
                </button>
              </div>
              {parseError && (
                <p className="param-note" style={{ color: "var(--danger, #b42318)" }}>
                  {parseError}
                </p>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={resetUpload}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ Replace warning 1 (step 2) */}
      {pendingFile && uploadMode === "replace" && !confirmDelete && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm replace">
            <div className="modal-head">
              <h3>
                <AlertIcon size={16} />
                You are about to delete the whole existing data
              </h3>
            </div>
            <div className="modal-body">
              <p className="param-note" style={{ margin: 0 }}>
                A <strong>New Upload</strong> permanently erases every existing PO row (
                {rows.length.toLocaleString("en-IN")} rows) before loading{" "}
                {parsedCount?.toLocaleString("en-IN")} new ones. Do you want to process?
              </p>
              <div className="po-warn-actions">
                <button className="btn" onClick={resetUpload}>
                  No
                </button>
                <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                  Yes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ Replace warning 2: typed code (step 3) */}
      {pendingFile && uploadMode === "replace" && confirmDelete && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Type code to delete">
            <div className="modal-head">
              <h3>
                <AlertIcon size={16} />
                Final confirmation
              </h3>
            </div>
            <div className="modal-body">
              <p className="param-note" style={{ margin: 0 }}>
                Please type this code to delete the existing data:
              </p>
              <div className="po-confirm-code">{confirmCode}</div>
              <input
                className="po-code-input"
                placeholder="Type the code above"
                value={typedCode}
                onChange={(e) => setTypedCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && typedCode === confirmCode && void runUpload()}
                autoFocus
              />
              <div className="po-warn-actions">
                <button className="btn" onClick={resetUpload}>
                  Cancel
                </button>                <button className="btn danger" onClick={() => void runUpload("replace")}
                  disabled={typedCode !== confirmCode || uploading}
                >
                  {uploading ? "Processing…" : "Delete & Upload"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ Edit confirmation (step 2) */}
      {editConfirm && editId != null && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm edit">
            <div className="modal-head">
              <h3>
                <CheckCircleIcon size={16} />
                Save this change?
              </h3>
              <button
                className="modal-close"
                onClick={() => setEditConfirm(false)}
                aria-label="Back"
              >
                <CloseIcon size={15} />
              </button>
            </div>
            <div className="modal-body">
              <p className="param-note" style={{ margin: 0 }}>
                Confirm the update for <strong>SKU {String(editDraft.sku_code ?? "")}</strong>:
              </p>
              <table className="po-edit-diff">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Current</th>
                    <th>New</th>
                  </tr>
                </thead>
                <tbody>
                  {EDITABLE.map((k) => {
                    const label = COLUMNS.find((c) => c.key === k)?.label ?? k;
                    const before = String(rows.find((r) => r.id === editId)?.[k] ?? "");
                    const after = String(editDraft[k] ?? "");
                    if (before === after) return null;
                    return (
                      <tr key={k}>
                        <td>{label}</td>
                        <td>{before || "—"}</td>
                        <td className="po-diff-new">{after || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="po-warn-actions">
                <button className="btn" onClick={() => setEditConfirm(false)}>
                  Back
                </button>
                <button className="btn primary" onClick={() => void confirmSaveEdit()} disabled={savingEdit}>
                  {savingEdit ? "Saving…" : "Yes, save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ Delete confirmation */}
      {deleteId != null && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && !deleting && setDeleteId(null)}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm delete">
            <div className="modal-head">
              <h3>
                <AlertIcon size={16} />
                Delete this row permanently?
              </h3>
              <button
                className="modal-close"
                onClick={() => setDeleteId(null)}
                aria-label="Cancel delete"
                disabled={deleting}
              >
                <CloseIcon size={15} />
              </button>
            </div>
            <div className="modal-body">
              <p className="param-note" style={{ margin: 0 }}>
                This removes the row from the database for everyone. It cannot be undone.
              </p>
              {deleteRow && (
                <table className="po-edit-diff">
                  <tbody>
                    {COLUMNS.map((c) => (
                      <tr key={String(c.key)}>
                        <td>{c.label}</td>
                        <td>
                          {c.key === "existing_stock" || c.key === "po_qty"
                            ? fmtNum(Number(deleteRow[c.key] ?? 0))
                            : String(deleteRow[c.key] ?? "") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="po-warn-actions">
                <button className="btn" onClick={() => setDeleteId(null)} disabled={deleting}>
                  Cancel
                </button>
                <button
                  className="btn danger"
                  onClick={() => void confirmDeleteRow()}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Yes, delete permanently"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ Toolbar: search + category + export */}
      <div className="table-toolbar po-toolbar">
        <div className="filters" style={{ flexWrap: "wrap", gap: 8 }}>
          <div className="sidebar-search" style={{ width: 300 }}>
            <span className="search-icon">
              <SearchIcon size={15} />
            </span>
            <input
              className="table-search"
              style={{ paddingLeft: 32 }}
              placeholder="Search SKU Code / Material Name / Category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <MultiSelect
            label="All Categories"
            options={categoryOptions}
            selected={category}
            onChange={setCategory}
            ariaLabel="Filter by category"
          />
        </div>
        <div className="historic-toolbar-right">
          <span className="row-count">
            {loading
              ? "Loading…"
              : `${filtered.length.toLocaleString("en-IN")} of ${rows.length.toLocaleString("en-IN")} rows`}
          </span>
          <button className="btn" onClick={exportCsv} disabled={loading || filtered.length === 0}>
            <DownloadIcon size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {/* ------------------------------------------------ Data table */}
      <div className="table-wrap historic-table">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 44 }}>#</th>
              {COLUMNS.map((c) => (
                <th key={String(c.key)}>{c.label}</th>
              ))}
              <th style={{ width: 100 }} />
            </tr>
          </thead>
          <tbody>
            {!loading &&
              filtered.slice(0, 500).map((r, i) => {
                const editing = editId === r.id;
                return (
                  <tr key={r.id} className={editing ? "po-editing" : ""}>
                    <td className="mapping-idx">{i + 1}</td>
                    {COLUMNS.map((c) => (
                      <td key={String(c.key)}>
                        {editing && EDITABLE.includes(c.key) ? (
                          c.key === "existing_stock" || c.key === "po_qty" ? (
                            <input
                              className="po-cell-input"
                              type="number"
                              value={String(editDraft[c.key] ?? "")}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, [c.key]: Number(e.target.value) }))
                              }
                            />
                          ) : (
                            <input
                              className="po-cell-input"
                              value={String(editDraft[c.key] ?? "")}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, [c.key]: e.target.value }))
                              }
                            />
                          )
                        ) : c.key === "existing_stock" || c.key === "po_qty" ? (
                          fmtNum(Number(r[c.key] ?? 0))
                        ) : (
                          String(r[c.key] ?? "")
                        )}
                      </td>
                    ))}
                    <td>
                      {editing ? (
                        <button className="btn primary po-row-btn" onClick={() => setEditConfirm(true)}>
                          Save
                        </button>
                      ) : (
                        <div className="po-row-actions">
                          <button
                            className="btn po-row-btn"
                            onClick={() => startEdit(r)}
                            title="Edit this row (confirmation required before saving)"
                          >
                            <PencilIcon size={13} />
                          </button>
                          <button
                            className="btn danger po-row-btn"
                            onClick={() => {
                              setRowError(null);
                              setRowNotice(null);
                              setDeleteId(r.id);
                            }}
                            title="Delete this row permanently from the database"
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="table-empty">
                  {rows.length === 0
                    ? "No PO data yet — upload the PO Excel above to get started."
                    : "No rows match your search."}
                </td>
              </tr>
            )}
          </tbody>
          {!loading && filtered.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>Total ({filtered.length.toLocaleString("en-IN")} rows)</td>
                <td className="num">{fmtNum(totals.stock)}</td>
                <td className="num">{fmtNum(totals.qty)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
        {!loading && filtered.length > 500 && (
          <div className="table-more-hint">
            Showing first 500 of {filtered.length.toLocaleString("en-IN")} matching rows — use
            search / category to narrow down.
          </div>
        )}
      </div>

      {rowNotice && (
        <div className="upload-success">
          <CheckCircleIcon size={14} />
          {rowNotice}
        </div>
      )}

      {rowError && (
        <div className="upload-error">
          <AlertIcon size={14} />
          {rowError}
        </div>
      )}

      <div className="historic-footnote">
        Upload replaces or appends PO rows · edit or delete any row with confirmation · {rows.length === 0 && "run scripts/migration-po-rows.sql in Supabase if the table is missing."}
      </div>
    </div>
  );
}
