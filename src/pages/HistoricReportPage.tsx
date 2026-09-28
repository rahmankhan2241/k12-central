import { useMemo, useState } from "react";
import { useBranchZbhMapping } from "../useBranchZbhMapping";
import { useHistoricGlobal } from "../useHistoricFetch";
import { findZoneByBranchEduvate } from "../types";
import type { BranchZbhMapping } from "../types";
import { exportPaymentExcel } from "../exportPaymentExcel";
import type { PaymentExportRow } from "../exportPaymentExcel";
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  FileReportIcon,
  RefreshIcon,
  SearchIcon,
} from "../icons";

type TabId = "payment" | "admission";

const TABS: { id: TabId; label: string }[] = [
  { id: "payment", label: "Payment Report" },
  { id: "admission", label: "Admission Report (coming soon)" },
];

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "never";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) === 1 ? "" : "s"} ago`;
}

export default function HistoricReportPage() {
  const [tab, setTab] = useState<TabId>("payment");
  const {
    logs,
    logsLoading,
    fetching,
    fetchError,
    fetchNow,
    fetchPhase,
    rows,
    dataLoading,
    loadError,
  } = useHistoricGlobal();
  const { rows: mapping, setRows: setMappingRows, status: mappingStatus } = useBranchZbhMapping();

  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [studentType, setStudentType] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [skippedBranches, setSkippedBranches] = useState<Set<string>>(new Set());
  const [manualZone, setManualZone] = useState<Record<string, Partial<BranchZbhMapping>>>({});
  const [zoneHint, setZoneHint] = useState<Record<string, string>>({});
  const [showExportChoice, setShowExportChoice] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const log = logs["payment_report"];
  const busy = fetchPhase !== "idle" || dataLoading;

  // Zone per branch (Branch (Eduvate) lookup in the Branch & ZBH Mapping).
  // In-progress typing in the unmapped card deliberately does NOT count here —
  // otherwise the row would vanish mid-typing. Only saved mapping rows matter.
  const zoneByBranch = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (map.has(r.branch)) continue;
      const m = findZoneByBranchEduvate(mapping, r.branch);
      map.set(r.branch, m ? m.zone || "(No zone)" : "");
    }
    return map;
  }, [rows, mapping]);

  const unmappedBranches = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (!zoneByBranch.get(r.branch) && !skippedBranches.has(r.branch)) set.add(r.branch);
    }
    return [...set].sort();
  }, [rows, zoneByBranch, skippedBranches]);

  const zoneOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of mapping) if (m.zone) set.add(m.zone);
    return [...set].sort();
  }, [mapping]);

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        zone: zoneByBranch.get(r.branch) || "(Unmapped)",
      })),
    [rows, zoneByBranch]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched.filter((r) => {
      if (branch && r.branch !== branch) return false;
      if (studentType && r.student_type !== studentType) return false;
      if (zoneFilter && r.zone !== zoneFilter) return false;
      if (!q) return true;
      return (
        r.branch.toLowerCase().includes(q) ||
        r.enrollment_code.toLowerCase().includes(q) ||
        r.grade.toLowerCase().includes(q) ||
        r.zone.toLowerCase().includes(q)
      );
    });
  }, [enriched, search, branch, studentType, zoneFilter]);

  // Branch options cascade from the selected zone: with Bangalore chosen, the
  // All Branches dropdown only lists branches that belong to Bangalore.
  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (!r.branch) return;
      if (zoneFilter && zoneByBranch.get(r.branch) !== zoneFilter) return;
      set.add(r.branch);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows, zoneByBranch, zoneFilter]);

  const changeZoneFilter = (z: string) => {
    setZoneFilter(z);
    // Reset the branch filter if it no longer belongs to the new zone.
    setBranch((cur) => (!cur || !z || (zoneByBranch.get(cur) ?? "") === z ? cur : ""));
  };

  const handleFetchNow = async () => {
    try {
      await fetchNow("payment");
    } catch {
      // surfaced via fetchError
    }
  };

  const hasActiveFilters = Boolean(search.trim() || branch || studentType || zoneFilter);

  const activeFilterSummary = [
    zoneFilter && `Zone: ${zoneFilter}`,
    branch && `Branch: ${branch}`,
    studentType && `Type: ${studentType}`,
    search.trim() && `Search: “${search.trim()}”`,
  ]
    .filter(Boolean)
    .join(" · ");

  const doExport = async (mode: "filtered" | "full") => {
    setExporting(true);
    setExportError(null);
    try {
      const source = mode === "filtered" ? filtered : enriched;
      const data: PaymentExportRow[] = source.map((r) => ({
        zone: r.zone,
        branch: r.branch,
        enrollment_code: r.enrollment_code,
        grade: r.grade,
        student_type: r.student_type,
        first_paid_date: r.first_paid_date,
      }));
      await exportPaymentExcel(data, mode);
    } catch (e) {
      setExportError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const addZoneForBranch = async (b: string) => {
    const vals = manualZone[b] ?? {};
    if (!vals.zone || !vals.zone.trim()) {
      setZoneHint((h) => ({ ...h, [b]: "Type a Zone first — ZBH is optional." }));
      return;
    }
    const existing = findZoneByBranchEduvate(mapping, b);
    const newRow: BranchZbhMapping = {
      zone: vals.zone.trim(),
      branchSap: existing?.branchSap ?? "",
      branchEduvate: b,
      zbh: vals.zbh?.trim() ?? existing?.zbh ?? "",
    };
    setMappingRows([...mapping, newRow]);
    setManualZone(({ [b]: _drop, ...rest }) => rest);
    setZoneHint(({ [b]: _drop, ...rest }) => rest);
    setSkippedBranches((s) => {
      const next = new Set(s);
      next.delete(b);
      return next;
    });
  };

  return (
    <div className="historic-page">
      <div className="page-head">
        <h1 className="page-title">
          <span className="title-chip">
            <FileReportIcon size={19} />
          </span>
          Historic Report
        </h1>
        <p className="page-subtitle">
          Auto-fetched daily at 8:00 AM from Eduvate. Payment Report shows the first payment
          per student (ERP).
        </p>
      </div>

      {/* Report tabs */}
      <div className="historic-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`historic-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
            disabled={t.id === "admission"}
            title={t.id === "admission" ? "Coming soon" : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Last-fetched banner + Fetch Now */}
      <div className="card historic-fetchbar">
        <div className="historic-fetchbar-info">
          <span
            className={`fetch-dot ${
              log?.last_status === "failed" ? "bad" : log?.last_status === "ok" ? "good" : ""
            }`}
          />
          <div>
            <div className="fetch-title">
              Payment Report
              {log?.last_row_count != null && log.last_row_count > 0 && (
                <span className="row-count" style={{ marginLeft: 10 }}>
                  {log.last_row_count.toLocaleString("en-IN")} students
                </span>
              )}
            </div>
            <div className="fetch-sub">
              {logsLoading
                ? "Checking fetch history…"
                : log
                  ? `Last fetched ${timeAgo(log.last_fetched_at)} (${fmtDateTime(log.last_fetched_at)})${
                      log.last_report_date ? ` · data for ${log.last_report_date}` : ""
                    }`
                  : "Never fetched yet — click Fetch Now to pull it from Eduvate."}
              {log?.last_status === "failed" && log?.last_error && (
                <span className="fetch-err"> · {log.last_error}</span>
              )}
            </div>
          </div>
        </div>
        <button className="btn primary" onClick={handleFetchNow} disabled={fetching}>
          <span className={fetching ? "spin" : ""} style={{ display: "inline-flex" }}>
            <RefreshIcon size={14} />
          </span>
          {fetching ? "Fetching…" : "Fetch Now"}
        </button>
      </div>

      {fetchError && (
        <div className="upload-error">
          <AlertIcon size={14} />
          Fetch failed: {fetchError}
          <button className="link-btn" onClick={handleFetchNow}>
            Retry
          </button>
        </div>
      )}

      {tab === "admission" ? (
        <div className="card">
          <div className="placeholder">
            <div className="placeholder-icon">
              <ClockIcon size={30} />
            </div>
            <h2>Admission Report — coming soon</h2>
            <p>This report will be wired up next. The Payment Report tab is live now.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Unmapped zone card */}
          {unmappedBranches.length > 0 && mappingStatus !== "loading" && !busy && (
            <div className="card unmapped-card">
              <div className="card-head">
                <div className="card-title">
                  <AlertIcon size={15} /> {unmappedBranches.length} branch
                  {unmappedBranches.length === 1 ? "" : "es"} without a Zone
                </div>
                <span className="row-count">Zone comes from Branch (Eduvate) in Settings → Branch &amp; ZBH Mapping</span>
              </div>
              <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {unmappedBranches.map((b) => {
                  const vals = manualZone[b] ?? {};
                  return (
                    <div className="unmapped-row" key={b}>
                      <span className="unmapped-branch" title={b}>{b}</span>
                      <input
                        placeholder="Zone"
                        value={vals.zone ?? ""}
                        onChange={(e) => {
                          setManualZone({ ...manualZone, [b]: { ...vals, zone: e.target.value } });
                          if (zoneHint[b]) setZoneHint(({ [b]: _drop, ...rest }) => rest);
                        }}
                      />
                      <input
                        placeholder="ZBH (optional)"
                        value={vals.zbh ?? ""}
                        onChange={(e) =>
                          setManualZone({ ...manualZone, [b]: { ...vals, zbh: e.target.value } })
                        }
                      />
                      <button className="btn primary" onClick={() => void addZoneForBranch(b)}>
                        <CheckCircleIcon size={14} /> Add
                      </button>
                      <button
                        className="btn"
                        onClick={() =>
                          setSkippedBranches((s) => new Set(s).add(b))
                        }
                      >
                        Skip
                      </button>
                      {zoneHint[b] && <span className="zone-hint">{zoneHint[b]}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Search + filters */}
          <div className="table-toolbar">
            <div className="filters" style={{ flexWrap: "wrap", gap: 8 }}>
              <div className="sidebar-search" style={{ width: 260 }}>
                <span className="search-icon">
                  <SearchIcon size={15} />
                </span>
                <input
                  className="table-search"
                  style={{ paddingLeft: 32 }}
                  placeholder="Search ERP / Branch / Grade / Zone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="filter-select"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                aria-label="Filter by branch"
              >
                <option value="">All Branches</option>
                {branchOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <select
                className="filter-select"
                value={zoneFilter}
                onChange={(e) => changeZoneFilter(e.target.value)}
                aria-label="Filter by zone"
              >
                <option value="">All Zones</option>
                {zoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
              <select
                className="filter-select"
                value={studentType}
                onChange={(e) => setStudentType(e.target.value)}
                aria-label="Filter by student type"
              >
                <option value="">New + Old</option>
                <option value="New">New</option>
                <option value="Old">Old</option>
              </select>
            </div>
            <div className="historic-toolbar-right">
              <span className="row-count">
                {busy
                  ? "Loading…"
                  : `${filtered.length.toLocaleString("en-IN")} of ${rows.length.toLocaleString("en-IN")} students`}
              </span>
              <button
                className="btn"
                onClick={() => {
                  setExportError(null);
                  // No filters active → export everything directly.
                  if (!hasActiveFilters) {
                    void doExport("full");
                    return;
                  }
                  setShowExportChoice(true);
                }}
                disabled={busy || exporting || rows.length === 0}
              >
                <span className={exporting ? "spin" : ""} style={{ display: "inline-flex" }}>
                  <DownloadIcon size={14} />
                </span>
                {exporting ? "Exporting…" : "Export Excel"}
              </button>
            </div>
          </div>

          {exportError && (
            <div className="upload-error">
              <AlertIcon size={14} />
              {exportError}
            </div>
          )}

          {/* Export scope choice — only shown when filters are active */}
          {showExportChoice && (
            <div
              className="modal-backdrop"
              onMouseDown={(e) => e.target === e.currentTarget && setShowExportChoice(false)}
            >
              <div className="modal" role="dialog" aria-modal="true" aria-label="Export Excel">
                <div className="modal-head">
                  <h3>
                    <DownloadIcon size={17} />
                    Export Excel
                  </h3>
                  <button
                    className="modal-close"
                    onClick={() => setShowExportChoice(false)}
                    aria-label="Close"
                  >
                    <CloseIcon size={15} />
                  </button>
                </div>
                <div className="modal-body">
                  <p className="param-note" style={{ margin: 0 }}>
                    You have active filters. Choose what to include in the export:
                  </p>
                  <div className="export-choice-grid">
                    <button
                      className="export-choice"
                      onClick={() => {
                        setShowExportChoice(false);
                        void doExport("filtered");
                      }}
                      disabled={exporting || filtered.length === 0}
                    >
                      <span className="export-choice-title">Current filtered</span>
                      <span className="export-choice-sub">
                        Only the {filtered.length.toLocaleString("en-IN")} rows matching your
                        filters
                      </span>
                      {activeFilterSummary && (
                        <span className="export-choice-tags">{activeFilterSummary}</span>
                      )}
                    </button>
                    <button
                      className="export-choice"
                      onClick={() => {
                        setShowExportChoice(false);
                        void doExport("full");
                      }}
                      disabled={exporting}
                    >
                      <span className="export-choice-title">Full Export</span>
                      <span className="export-choice-sub">
                        All {rows.length.toLocaleString("en-IN")} students, ignoring filters
                      </span>
                    </button>
                  </div>
                </div>
                <div className="modal-foot">
                  <button className="btn" onClick={() => setShowExportChoice(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {loadError && (
            <div className="upload-error">
              <AlertIcon size={14} />
              {loadError}
            </div>
          )}

          {/* Data table */}
          <div className="table-wrap historic-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th>Zone</th>
                  <th>Branch</th>
                  <th>Enrollment Code</th>
                  <th>Grade</th>
                  <th>Student Type</th>
                  <th>First Paid Date</th>
                </tr>
              </thead>
              <tbody>
                {!busy &&
                  filtered.slice(0, 500).map((r, i) => (
                    <tr key={r.id}>
                      <td className="mapping-idx">{i + 1}</td>
                      <td className={r.zone === "(Unmapped)" ? "zone-unmapped" : ""}>{r.zone}</td>
                      <td>{r.branch}</td>
                      <td>{r.enrollment_code}</td>
                      <td>{r.grade}</td>
                      <td>
                        <span className={`stype-chip ${r.student_type === "New" ? "new" : "old"}`}>
                          {r.student_type}
                        </span>
                      </td>
                      <td>{r.first_paid_date}</td>
                    </tr>
                  ))}
                {!busy && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="table-empty">
                      No students found{search || branch || studentType || zoneFilter ? " match your filters" : " — fetch the report to load data"}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {!busy && filtered.length > 500 && (
              <div className="table-more-hint">
                Showing first 500 of {filtered.length.toLocaleString("en-IN")} matching students. Use the filters to narrow down.
              </div>
            )}
          </div>

          <div className="historic-footnote">
            <ClockIcon size={13} />
            Auto-fetch daily 8:00 AM IST · one row per ERP (first payment) · taproot/PU branches
            excluded.
          </div>
        </>
      )}
    </div>
  );
}
