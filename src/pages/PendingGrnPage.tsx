import { useEffect, useMemo, useRef, useState } from "react";
import ReportParamsModal from "../components/ReportParamsModal";
import PreparedReportView from "../components/PreparedReportView";
import { prepareReport, type PreparedReport } from "../prepareReport";
import { useReportConfig } from "../useReportConfig";
import { useReportParams } from "../useReportParams";
import { useBranchZbhMapping } from "../useBranchZbhMapping";
import { FILE_ACCEPT, formatBytes, getExtension } from "../fileUtils";
import {
  findExtraColumns,
  findMissingColumns,
} from "../reportConfig";
import type { BranchZbhMapping, ParsedReport, ReportRow } from "../types";
import { registerGrnSource, unregisterGrnSource } from "../askAiSource";
import {
  loadGrnSnapshot,
  saveGrnSnapshot,
  type GrnSnapshot,
} from "../grnSnapshot";
import {
  AlertIcon,
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  FileIcon,
  FileReportIcon,
  GearIcon,
  RefreshIcon,
  SearchIcon,
  UploadIcon,
} from "../icons";

export default function PendingGrnPage() {
  const [paramsOpen, setParamsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ParsedReport | null>(null);
  // Cloud snapshot of the last uploaded file — restored on load so the page
  // always shows the last-updated data, even after a reload or on another PC.
  const [snapshotStatus, setSnapshotStatus] = useState<"loading" | "saved" | "saving" | "failed" | "none">("loading");
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  /** Name of the raw file the restored prepared report came from. */
  const [reportFileName, setReportFileName] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    kind: "error" | "success";
    missing: string[];
    extra: string[];
    fileName: string;
  } | null>(null);
  const {
    columns: expectedColumns,
    status: syncStatus,
    retrySave,
  } = useReportConfig();
  const { params, save: saveParams } = useReportParams();
  const {
    rows: branchZbhMapping,
    setRows: setBranchZbhMapping,
    status: mappingStatus,
  } = useBranchZbhMapping();
  const [prepareNote, setPrepareNote] = useState(false);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  const validationOk = banner?.kind === "success";

  // Restore the last PREPARED report from the database on first load, so the
  // page reopens on the final result (never the raw file).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const snap = await loadGrnSnapshot();
      if (cancelled) return;
      if (!snap) {
        setSnapshotStatus("none");
        return;
      }
      setReportFileName(snap.fileName);
      setPrepared((prev) => {
        if (prev) return prev; // already working on something this session
        return {
          generatedAt: new Date(snap.generatedAt),
          paramsUsed: snap.paramsUsed,
          funnel: snap.funnel,
          finalRowCount: snap.finalRowCount,
          overallDistinctDocs: snap.overallDistinctDocs,
          plantRows: snap.plantRows,
          filteredRows: snap.filteredRows.map((cells, i) => ({ id: i, cells })),
          filteredRowZbh: snap.filteredRowZbh,
          columnsForExport: snap.columnsForExport,
          warnings: snap.warnings,
        };
      });
      setSnapshotStatus("saved");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Expose the uploaded file to the Ask AI agent (it analyses it in memory).
  useEffect(() => {
    if (!report) return;
    registerGrnSource({
      fileName: report.fileName,
      columns: report.columns,
      rowCount: report.rows.length,
      getRows: () => report.rows.map((r) => r.cells),
    });
    return () => unregisterGrnSource();
  }, [report]);

  // When only the PREPARED result was restored (no raw file in memory), Ask AI
  // analyses the final filtered rows of that prepared report.
  useEffect(() => {
    if (report || !prepared) return;
    registerGrnSource({
      fileName: "Prepared GRN report (last saved)",
      columns: prepared.columnsForExport,
      rowCount: prepared.filteredRows.length,
      getRows: () => prepared.filteredRows.map((r) => r.cells),
    });
    return () => unregisterGrnSource();
  }, [report, prepared]);

  const visibleRows = useMemo(() => {
    if (!report) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return report.rows;
    return report.rows.filter((r) =>
      r.cells.some((c) => String(c).toLowerCase().includes(q))
    );
  }, [report, filter]);

  const pageRows = visibleRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));

  const parse = async (file: File) => {
    const buf = await file.arrayBuffer();
    // Heavy library loaded on demand — keeps the initial bundle small.
    const XLSX = await import("xlsx");
    // cellDates: properly formatted date cells arrive as real Date objects
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      blankrows: false,
      raw: true,
    });
    // Normalize every cell to a string; Date cells become ISO yyyy-mm-dd
    // so the date parser never has to guess regional formats.
    const matrix = rawMatrix.map((row) =>
      (row ?? []).map((cell) => {
        if (cell instanceof Date) {
          const y = cell.getFullYear();
          const m = String(cell.getMonth() + 1).padStart(2, "0");
          const d = String(cell.getDate()).padStart(2, "0");
          return `${y}-${m}-${d}`;
        }
        return cell === null || cell === undefined ? "" : String(cell);
      })
    );
    // Trim fully-empty leading rows; first remaining row is the header.
    let start = 0;
    while (start < matrix.length && matrix[start].every((c) => String(c).trim() === "")) start++;
    const headerRow = matrix[start] ?? [];
    const fileColumns = headerRow.map((c, i) => {
      const name = String(c).trim();
      return name === "" ? `Column ${i + 1}` : name;
    });
    const rows: ReportRow[] = matrix.slice(start + 1).map((r, i) => ({
      id: i,
      cells: fileColumns.map((_, ci) => (r[ci] !== undefined ? r[ci] : "")),
    }));

    // ---- Column-mapping validation (case-insensitive) ----
    const missing = findMissingColumns(expectedColumns, fileColumns);
    const extra = findExtraColumns(expectedColumns, fileColumns);
    setBanner({
      kind: missing.length > 0 ? "error" : "success",
      missing,
      extra,
      fileName: file.name,
    });

    setReport({
      fileName: file.name,
      fileSize: file.size,
      sheetName,
      columns: fileColumns,
      rows,
      uploadedAt: new Date(),
    });
    setFilter("");
    setPage(0);
  };

  const exportCsv = async () => {
    if (!report) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([report.columns, ...report.rows.map((r) => r.cells)]);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `PendingGRN_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pickFile = (file: File | null | undefined) => {
    setUploadError(null);
    setPrepared(null);
    if (!file) return;
    if (!getExtension(file.name)) {
      setUploadError("Unsupported file type. Please upload a .csv, .xlsx or .xls file.");
      return;
    }
    void parse(file);
  };

  const changeFile = () => {
    fileInputRef.current?.click();
  };

  const runPrepare = () => {
    if (!report) return;
    const result = prepareReport(report, params, branchZbhMapping);
    setPrepared(result);
    setPrepareNote(false);

    // Persist the FINAL prepared result (not the raw file) so reloads and
    // other devices reopen straight on these numbers.
    const snapshot: GrnSnapshot = {
      kind: "prepared",
      fileName: report.fileName,
      sheetName: report.sheetName,
      generatedAt: result.generatedAt.toISOString(),
      paramsUsed: {
        startDate: params.startDate,
        endDate: params.endDate,
        taproot: params.taproot,
      },
      funnel: result.funnel,
      finalRowCount: result.finalRowCount,
      overallDistinctDocs: result.overallDistinctDocs,
      plantRows: result.plantRows,
      filteredRows: result.filteredRows.map((r) => r.cells),
      filteredRowZbh: result.filteredRowZbh,
      columnsForExport: result.columnsForExport,
      warnings: result.warnings,
    };
    setSnapshotStatus("saving");
    setSnapshotError(null);
    void saveGrnSnapshot(snapshot).then((res) => {
      if (res.ok) setSnapshotStatus("saved");
      else {
        setSnapshotStatus("failed");
        setSnapshotError(res.error ?? "Could not save to the database.");
      }
    });
  };

  // From the unmapped-plants card: append rows to the saved mapping, then
  // re-run the engine so the new ZBHs appear immediately.
  const addMappingRows = (newRows: BranchZbhMapping[]) => {
    const merged = [...branchZbhMapping, ...newRows];
    setBranchZbhMapping(merged);
    if (!report) return;
    setPrepared(prepareReport(report, params, merged));
  };

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <span className="title-chip">
            <FileReportIcon size={19} />
          </span>
          Pending GRN Report
          <span className={`sync-pill ${syncStatus}`} title={
            syncStatus === "saved"
              ? "Configuration is stored in the K12 Central database"
              : syncStatus === "saving"
              ? "Saving your change to the K12 Central database..."
              : syncStatus === "loading"
              ? "Connecting to the K12 Central database..."
              : "Could not reach the database — your change is kept on this device. Click to retry."
          }>
            {syncStatus === "saved"
              ? "Saved to cloud"
              : syncStatus === "saving"
              ? "Saving…"
              : syncStatus === "loading"
              ? "Syncing…"
              : "Save failed — Retry"}
          </span>
          {syncStatus === "failed" && (
            <button className="sync-pill failed" onClick={retrySave} title="Retry saving to the database">
              Retry
            </button>
          )}
        </h1>
        <p className="page-subtitle">
          Upload your RAW file to generate the Pending GRN report.
        </p>
      </div>

      {prepareNote && (
        <div className="validation-banner success" role="status">
          <span style={{ marginTop: 1, flexShrink: 0 }}>
            <CheckCircleIcon size={17} />
          </span>
          <div>
            File validated with the saved period (Start <b>{params.startDate}</b>, End{" "}
            <b>{params.endDate}</b>, Taproot <b>{params.taproot ? "Yes" : "No"}</b>). Report
            generation will be wired up in the next step.
          </div>
          <button className="vib-close" onClick={() => setPrepareNote(false)} aria-label="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {banner && (
        <div
          className={`validation-banner ${banner.kind}`}
          role={banner.kind === "error" ? "alert" : "status"}
        >
          <span style={{ marginTop: 1, flexShrink: 0 }}>
            {banner.kind === "error" ? <AlertIcon size={17} /> : <CheckCircleIcon size={17} />}
          </span>
          <div>
            {banner.kind === "error" ? (
              <>
                {banner.missing.length} column{banner.missing.length === 1 ? "" : "s"} from your
                mapping not found in <b>{banner.fileName}</b>:
                <ul>
                  {banner.missing.map((m) => (
                    <li key={m}>
                      <b>{m}</b> — no matching column in the uploaded file
                    </li>
                  ))}
                </ul>
                Update the file, or adjust Column Mapping in the Settings tab.
              </>
            ) : (
              <>
                All {expectedColumns.length} mapped columns found in <b>{banner.fileName}</b>.
                {banner.extra.length > 0 && (
                  <>
                    {" "}
                    {banner.extra.length} extra column{banner.extra.length === 1 ? "" : "s"} present
                    in the file: <b>{banner.extra.join(", ")}</b>
                  </>
                )}
              </>
            )}
          </div>
          <button className="vib-close" onClick={() => setBanner(null)} aria-label="Dismiss">
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      {prepared ? (
        <>
          {!report && (
            <div className="validation-banner success" role="status" style={{ marginBottom: 14 }}>
              <span style={{ marginTop: 1, flexShrink: 0 }}>
                <CheckCircleIcon size={17} />
              </span>
              <div>
                Last prepared report restored from the cloud — generated{" "}
                <b>
                  {prepared.generatedAt.toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </b>
                {" "}from <b>{reportFileName ?? "the last uploaded file"}</b>. Upload the RAW file
                again to re-run it with fresh data.
              </div>
            </div>
          )}
          {snapshotStatus !== "none" && (
            <div className="param-note" style={{ marginBottom: 8 }}>
              Cloud snapshot:{" "}
              {snapshotStatus === "saving" && "saving final result…"}
              {snapshotStatus === "saved" && "final result saved ✓"}
              {snapshotStatus === "failed" &&
                `save failed${snapshotError ? ` — ${snapshotError}` : ""}`}
            </div>
          )}
          <PreparedReportView
            prepared={prepared}
            onBack={() => setPrepared(null)}
            mapping={branchZbhMapping}
            mappingStatus={mappingStatus}
            onAddMappingRows={addMappingRows}
          />
        </>
      ) : !report ? (
        <div className="card upload-card">
          <div
            className={`dropzone ${dragOver ? "drag" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files?.[0]);
            }}
          >
            <div className="dropzone-icon">
              <UploadIcon size={28} />
            </div>
            <div className="dropzone-title">Drop your RAW file here</div>
            <div className="dropzone-sub">or click to browse your computer</div>
            <div className="dropzone-hint">
              <span className="filetype-chip">CSV</span>
              <span className="filetype-chip">XLSX</span>
              <span className="filetype-chip">XLS</span>
            </div>
          </div>
          {uploadError && (
            <div className="upload-error" style={{ marginTop: 14 }}>
              <CloseIcon size={14} />
              {uploadError}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="card card-body file-banner" style={{ padding: "13px 16px" }}>
            <div className="file-banner-icon">
              <FileIcon size={22} />
            </div>
            <div>
              <div className="file-banner-name">{report.fileName}</div>
              <div className="file-banner-meta">
                Sheet “{report.sheetName}” · {formatBytes(report.fileSize)} ·{" "}
                {report.rows.length.toLocaleString("en-IN")} rows · uploaded{" "}
                {report.uploadedAt.toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" · "}
                {snapshotStatus === "saving" && "Saving to cloud…"}
                {snapshotStatus === "saved" && "Saved to cloud ✓"}
                {snapshotStatus === "failed" && `Cloud save failed${snapshotError ? ` — ${snapshotError}` : ""}`}
              </div>
            </div>
            <div className="file-banner-actions">
              <button className="btn" onClick={() => setParamsOpen(true)}>
                <GearIcon size={14} />
                Settings
              </button>
              <button className="btn" onClick={changeFile}>
                <RefreshIcon size={14} />
                Change file
              </button>
              {validationOk ? (
                <button className="btn success" onClick={runPrepare}>
                  <FileReportIcon size={14} />
                  Prepare Report
                </button>
              ) : (
                <button className="btn primary" onClick={() => void exportCsv()}>
                  <DownloadIcon size={14} />
                  Export CSV
                </button>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="table-toolbar">
              <div className="filters">
                <div className="sidebar-search" style={{ width: 240 }}>
                  <span className="search-icon">
                    <SearchIcon size={15} />
                  </span>
                  <input
                    className="table-search"
                    style={{ paddingLeft: 32 }}
                    placeholder="Search rows..."
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setPage(0);
                    }}
                  />
                </div>
              </div>
              <span className="row-count">
                {visibleRows.length.toLocaleString("en-IN")} of{" "}
                {report.rows.length.toLocaleString("en-IN")} rows
              </span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {report.columns.map((c, i) => (
                      <th key={i}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr key={row.id}>
                      {row.cells.map((cell, ci) => (
                        <td key={ci} title={String(cell)}>
                          {String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={report.columns.length} className="table-empty">
                        No rows match “{filter}”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="table-toolbar" style={{ borderTop: "1px solid var(--line-soft)" }}>
                <span className="row-count">
                  Page {page + 1} of {totalPages}
                </span>
                <div className="card-actions">
                  <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    ← Prev
                  </button>
                  <button
                    className="btn"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage(page + 1)}
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        style={{ display: "none" }}
        onChange={(e) => {
          pickFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <ReportParamsModal
        open={paramsOpen}
        params={params}
        onSave={saveParams}
        onClose={() => setParamsOpen(false)}
      />
    </div>
  );
}
