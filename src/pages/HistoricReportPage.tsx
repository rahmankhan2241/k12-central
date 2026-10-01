import { useEffect, useMemo, useRef, useState } from "react";
import { useBranchZbhMapping } from "../useBranchZbhMapping";
import { useIcseConfig } from "../useIcseConfig";
import { useHistoricGlobal } from "../useHistoricFetch";
import MultiSelect from "../components/MultiSelect";
import DateMultiSelect, {
  dateLabel,
  monthLabel,
  EMPTY_DATE_SELECTION,
  type DateSelection,
} from "../components/DateMultiSelect";
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

// 2027-28 is listed but disabled — the session hasn't started at Eduvate yet.
const ACADEMIC_YEARS: string[] = ["2026-27", "2025-26", "2024-25", "2027-28"];

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

function YearIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function ChevronIcon({ size = 14, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Styled academic-year picker (native <select> can't be customized).
 * Renders a button + popover with one card per year; 2027-28 is shown
 * but disabled until the session starts at Eduvate.
 */
function YearDropdown({
  years,
  value,
  onChange,
}: {
  years: string[];
  value: string;
  onChange: (y: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="year-dd" ref={ref}>
      <button
        type="button"
        className="year-dd-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch academic year — each year's data is fetched and stored separately"
      >
        <span className="year-dd-icon">
          <YearIcon />
        </span>
        <span className="year-dd-label">
          <span className="year-dd-cap">Academic Year</span>
          <span className="year-dd-value">{value}</span>
        </span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="year-dd-menu" role="listbox">
          {years.map((y) => {
            const disabled = y === "2027-28";
            return (
              <button
                key={y}
                type="button"
                role="option"
                aria-selected={y === value}
                className={`year-dd-item ${y === value ? "active" : ""} ${disabled ? "disabled" : ""}`}
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  onChange(y);
                }}
              >
                <span className="year-dd-year">{y}</span>
                {disabled ? (
                  <span className="year-dd-tag">not started</span>
                ) : y === value ? (
                  <span className="year-dd-check">✓</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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
    selectedYear,
    setSelectedYear,
    needsMigration,
  } = useHistoricGlobal();
  const { rows: mapping, setRows: setMappingRows, status: mappingStatus } = useBranchZbhMapping();
  const { isIcse } = useIcseConfig();

  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState<string[]>([]);
  const [studentType, setStudentType] = useState<string[]>([]);
  const [grade, setGrade] = useState<string[]>([]);
  const [segment, setSegment] = useState<string[]>([]);
  const [zoneFilter, setZoneFilter] = useState<string[]>([]);
  // Excel-style month/date filter: months fully selected + individually
  // picked dates in partially-selected months.
  const [dateSel, setDateSel] = useState<DateSelection>(EMPTY_DATE_SELECTION);
  const [skippedBranches, setSkippedBranches] = useState<Set<string>>(new Set());
  const [manualZone, setManualZone] = useState<Record<string, Partial<BranchZbhMapping>>>({});
  const [zoneHint, setZoneHint] = useState<Record<string, string>>({});
  const [showExportChoice, setShowExportChoice] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const log = logs[`payment_report:${selectedYear}`] ?? logs["payment_report"];
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

  // (zone options are cross-cascaded below, alongside branch/grade options)

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        zone: zoneByBranch.get(r.branch) || "(Unmapped)",
        // ICSE when Branch Name + Grade match a rule in Settings → ICSE Configuration, else OIS.
        segment: isIcse(r.branch, r.grade) ? "ICSE" : "OIS",
      })),
    [rows, zoneByBranch, isIcse]
  );

  const includesAny = (sel: string[], v: string) => sel.length === 0 || sel.includes(v);

  // Excel-style cascading: each dropdown is narrowed by every OTHER filter
  // (Bangalore selected → Branches lists only Bangalore branches), but always
  // shows ALL of its own values so a deselected one stays visible to re-select.
  const gradeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of enriched) {
      if (!r.grade) continue;
      if (!includesAny(zoneFilter, r.zone)) continue;
      if (!includesAny(branch, r.branch)) continue;
      if (!includesAny(segment, r.segment)) continue;
      set.add(r.grade);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, zoneFilter.join("|"), branch.join("|"), segment.join("|")]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hasDateFilter = dateSel.months.length > 0 || dateSel.dates.length > 0;
    return enriched.filter((r) => {
      if (!includesAny(branch, r.branch)) return false;
      if (!includesAny(studentType, r.student_type)) return false;
      if (!includesAny(grade, r.grade)) return false;
      if (!includesAny(zoneFilter, r.zone)) return false;
      if (!includesAny(segment, r.segment)) return false;
      if (hasDateFilter) {
        const d = (r.first_paid_date ?? "").slice(0, 10);
        if (!dateSel.months.includes(d.slice(0, 7)) && !dateSel.dates.includes(d)) return false;
      }
      if (!q) return true;
      return (
        r.branch.toLowerCase().includes(q) ||
        r.enrollment_code.toLowerCase().includes(q) ||
        r.grade.toLowerCase().includes(q) ||
        r.zone.toLowerCase().includes(q)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, search, branch.join("|"), studentType.join("|"), grade.join("|"), segment.join("|"), zoneFilter.join("|"), dateSel.months.join("|"), dateSel.dates.join("|")]);

  // Month + per-month date options for the date filter — cascaded by every
  // OTHER filter (Excel-style), never pruned against the selection itself.
  const dateOptions = useMemo(() => {
    const byMonth = new Map<string, Set<string>>();
    for (const r of enriched) {
      const d = (r.first_paid_date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (!includesAny(zoneFilter, r.zone)) continue;
      if (!includesAny(branch, r.branch)) continue;
      if (!includesAny(studentType, r.student_type)) continue;
      if (!includesAny(grade, r.grade)) continue;
      if (!includesAny(segment, r.segment)) continue;
      const ym = d.slice(0, 7);
      let set = byMonth.get(ym);
      if (!set) {
        set = new Set();
        byMonth.set(ym, set);
      }
      set.add(d);
    }
    const months = [...byMonth.keys()].sort();
    const datesByMonth: Record<string, string[]> = {};
    for (const [ym, set] of byMonth) datesByMonth[ym] = [...set].sort();
    return { months, datesByMonth };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, zoneFilter.join("|"), branch.join("|"), studentType.join("|"), grade.join("|"), segment.join("|")]);

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    enriched.forEach((r) => {
      if (!r.branch) return;
      if (!includesAny(zoneFilter, r.zone)) return;
      if (!includesAny(segment, r.segment)) return;
      if (!includesAny(grade, r.grade)) return;
      set.add(r.branch);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, zoneFilter.join("|"), segment.join("|"), grade.join("|")]);

  const zoneOptionsFiltered = useMemo(() => {
    const set = new Set<string>();
    for (const r of enriched) {
      if (!r.zone || r.zone === "(Unmapped)") continue;
      if (!includesAny(branch, r.branch)) continue;
      if (!includesAny(segment, r.segment)) continue;
      if (!includesAny(grade, r.grade)) continue;
      set.add(r.zone);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, branch.join("|"), segment.join("|"), grade.join("|")]);

  const handleFetchNow = async () => {
    try {
      await fetchNow("payment", selectedYear);
    } catch {
      // surfaced via fetchError
    }
  };

  const hasActiveFilters =
    search.trim().length > 0 ||
    branch.length > 0 ||
    studentType.length > 0 ||
    grade.length > 0 ||
    segment.length > 0 ||
    zoneFilter.length > 0 ||
    dateSel.months.length > 0 ||
    dateSel.dates.length > 0;

  const joinList = (sel: string[]) => (sel.length <= 3 ? sel.join(", ") : `${sel.length} selected`);
  const dateFilterSummary = (() => {
    const parts: string[] = dateSel.months.map((m) => monthLabel(m));
    if (dateSel.dates.length > 0) {
      if (dateSel.dates.length <= 3) parts.push(...dateSel.dates.map((d) => dateLabel(d)));
      else parts.push(`${dateSel.dates.length} dates`);
    }
    return parts.join(", ");
  })();
  const activeFilterSummary = [
    zoneFilter.length > 0 && `Zone: ${joinList(zoneFilter)}`,
    branch.length > 0 && `Branch: ${joinList(branch)}`,
    studentType.length > 0 && `Type: ${joinList(studentType)}`,
    grade.length > 0 && `Grade: ${joinList(grade)}`,
    segment.length > 0 && `Segment: ${joinList(segment)}`,
    dateFilterSummary && `Date: ${dateFilterSummary}`,
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
        segment: r.segment,
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
              Payment Report · {selectedYear}
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
                      log.last_report_date ? ` · data till ${log.last_report_date}` : ""
                    }`
                  : selectedYear === "2026-27"
                    ? "Never fetched yet — click Fetch Now to pull it from Eduvate."
                    : "Never fetched for this year — click Fetch Now (takes 30–60s)."}
              {log?.last_status === "failed" && log?.last_error && (
                <span className="fetch-err"> · {log.last_error}</span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <YearDropdown years={ACADEMIC_YEARS} value={selectedYear} onChange={setSelectedYear} />
          <button
            className="btn primary"
            onClick={handleFetchNow}
            disabled={fetching}
            title="Runs the whole pipeline for the selected year: downloads from Eduvate, filters and dedupes, writes to Supabase, then refreshes this page"
          >
            <span className={fetching ? "spin" : ""} style={{ display: "inline-flex" }}>
              <RefreshIcon size={14} />
            </span>
            {fetching ? "Running pipeline…" : "Fetch Now"}
          </button>
        </div>
      </div>

      {needsMigration && (
        <div className="upload-error">
          <AlertIcon size={14} />
          Database setup needed: run <code>scripts/migration-session-year.sql</code> in the
          Supabase SQL Editor to enable multiple academic years. Until then only 2026-27 data
          is available.
        </div>
      )}

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
              <MultiSelect
                label="All Branches"
                options={branchOptions}
                selected={branch}
                onChange={setBranch}
                ariaLabel="Filter by branch"
              />
              <MultiSelect
                label="All Zones"
                options={zoneOptionsFiltered}
                selected={zoneFilter}
                onChange={setZoneFilter}
                ariaLabel="Filter by zone"
              />
              <MultiSelect
                label="New + Old"
                options={["New", "Old"]}
                selected={studentType}
                onChange={setStudentType}
                ariaLabel="Filter by student type"
              />
              <MultiSelect
                label="All Grades"
                options={gradeOptions}
                selected={grade}
                onChange={setGrade}
                ariaLabel="Filter by grade"
              />
              <MultiSelect
                label="ICSE + OIS"
                options={["ICSE", "OIS"]}
                selected={segment}
                onChange={setSegment}
                ariaLabel="Filter by segment"
              />
              <DateMultiSelect
                label="All Dates"
                months={dateOptions.months}
                datesByMonth={dateOptions.datesByMonth}
                selected={dateSel}
                onChange={setDateSel}
                ariaLabel="Filter by payment date — months expand to individual dates"
              />
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
                  <th>Segment</th>
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
                      <td>
                        <span className={`segment-chip ${r.segment === "ICSE" ? "icse" : "ois"}`}>
                          {r.segment}
                        </span>
                      </td>
                      <td>{r.first_paid_date}</td>
                    </tr>
                  ))}
                {!busy && filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="table-empty">
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
