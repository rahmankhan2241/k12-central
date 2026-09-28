import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { useBranchZbhMapping } from "../useBranchZbhMapping";
import { useHistoricFetch } from "../useHistoricFetch";
import { findZoneByBranchEduvate } from "../types";
import type { BranchZbhMapping, PaymentReportRow } from "../types";
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
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
  const { logs, loading: logsLoading, fetching, fetchError, fetchNow } = useHistoricFetch();
  const { rows: mapping, setRows: setMappingRows, status: mappingStatus } = useBranchZbhMapping();

  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [studentType, setStudentType] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [rows, setRows] = useState<PaymentReportRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skippedBranches, setSkippedBranches] = useState<Set<string>>(new Set());
  const [manualZone, setManualZone] = useState<Record<string, Partial<BranchZbhMapping>>>({});
  const [zoneHint, setZoneHint] = useState<Record<string, string>>({});

  const log = logs["payment_report"];

  // Load payment rows
  useEffect(() => {
    if (tab !== "payment") return;
    let cancelled = false;
    (async () => {
      setDataLoading(true);
      setLoadError(null);
      if (!isSupabaseConfigured) {
        setLoadError("Supabase is not configured.");
        setDataLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("payment_report_rows")
        .select("*")
        .order("first_paid_date", { ascending: true })
        .range(0, 1999999); // fetch all — PostgREST hard-caps .limit() at 1000
      if (cancelled) return;
      if (error) {
        const msg =
          typeof error === "object" && error !== null && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        setLoadError(msg);
      } else {
        setRows((data ?? []) as PaymentReportRow[]);
      }
      setDataLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, log?.last_fetched_at]);

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

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.branch && set.add(r.branch));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const handleFetchNow = async () => {
    try {
      await fetchNow("payment");
    } catch {
      // surfaced via fetchError
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
    // Save to the shared mapping (persists to Supabase + localStorage cache).
    setMappingRows([...mapping, newRow]);
    // Clear the in-progress inputs; the row leaves the unmapped list because
    // the saved mapping now contains it.
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
          <RefreshIcon size={14} />
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
          {unmappedBranches.length > 0 && mappingStatus !== "loading" && (
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
                onChange={(e) => setZoneFilter(e.target.value)}
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
            <span className="row-count">
              {dataLoading
                ? "Loading…"
                : `${filtered.length.toLocaleString("en-IN")} of ${rows.length.toLocaleString("en-IN")} students`}
            </span>
          </div>

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
                {dataLoading && (
                  <tr>
                    <td colSpan={7} className="table-empty">
                      Loading data…
                    </td>
                  </tr>
                )}
                {!dataLoading &&
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
                {!dataLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="table-empty">
                      No students found{search || branch || studentType || zoneFilter ? " match your filters" : " — fetch the report to load data"}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {filtered.length > 500 && (
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
