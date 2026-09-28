import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { useHistoricFetch } from "../useHistoricFetch";
import { useHistoricColumns } from "../useHistoricColumns";
import type { HistoricStoreRow, HistoricTpndRow } from "../types";
import type { HistoricReportKey } from "../useHistoricColumns";
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  FileReportIcon,
  RefreshIcon,
  SearchIcon,
} from "../icons";

type TabId = HistoricReportKey;

const TABS: { id: TabId; label: string }[] = [
  { id: "tpnd_installment", label: "TPND Report" },
  { id: "store_kit_wise", label: "Store Report - Kit Wise" },
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

function match(obj: Record<string, unknown>, q: string): boolean {
  return Object.values(obj).some(
    (v) => v != null && String(v).toLowerCase().includes(q)
  );
}

export default function HistoricReportPage() {
  const [tab, setTab] = useState<TabId>("tpnd_installment");
  const { logs, loading: logsLoading, fetching, fetchError, fetchNow } = useHistoricFetch();
  const { columns: visibleCols, allColumns, toggleColumn, resetColumns } =
    useHistoricColumns(tab);

  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [status, setStatus] = useState("");
  const [rowsTpnd, setRowsTpnd] = useState<HistoricTpndRow[]>([]);
  const [rowsStore, setRowsStore] = useState<HistoricStoreRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const latestDate = logs[tab]?.last_report_date ?? null;

  // Load data rows (latest report_date per report)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDataLoading(true);
      setLoadError(null);
      if (!isSupabaseConfigured) {
        setLoadError("Supabase is not configured.");
        setDataLoading(false);
        return;
      }
      try {
        if (tab === "tpnd_installment") {
          let q = supabase
            .from("historic_tpnd_rows")
            .select("*")
            .order("report_date", { ascending: false })
            .limit(20000);
          if (latestDate) q = q.eq("report_date", latestDate);
          const { data, error } = await q;
          if (cancelled) return;
          if (error) throw error;
          setRowsTpnd((data ?? []) as HistoricTpndRow[]);
          setRowsStore([]);
        } else {
          let q = supabase
            .from("historic_store_rows")
            .select("*")
            .order("report_date", { ascending: false })
            .limit(20000);
          if (latestDate) q = q.eq("report_date", latestDate);
          const { data, error } = await q;
          if (cancelled) return;
          if (error) throw error;
          setRowsStore((data ?? []) as HistoricStoreRow[]);
          setRowsTpnd([]);
        }
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "object" && e !== null && "message" in e
              ? String((e as { message: unknown }).message)
              : String(e);
        if (!cancelled) setLoadError(msg);
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, latestDate, logs]);

  // Distinct filter values
  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    if (tab === "tpnd_installment") rowsTpnd.forEach((r) => r.branch_name && set.add(r.branch_name));
    else rowsStore.forEach((r) => r.branch && set.add(r.branch));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tab, rowsTpnd, rowsStore]);

  const statusOptions = useMemo(() => {
    if (tab !== "tpnd_installment") return [];
    const set = new Set<string>();
    rowsTpnd.forEach((r) => r.permanent_status && set.add(r.permanent_status));
    return [...set].sort();
  }, [tab, rowsTpnd]);

  // Filtering
  const filteredTpnd = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rowsTpnd.filter((r) => {
      if (branch && r.branch_name !== branch) return false;
      if (status && r.permanent_status.toLowerCase() !== status.toLowerCase()) return false;
      if (!q) return true;
      return match(
        {
          branch_name: r.branch_name,
          grade: r.grade,
          enrollment_code: r.enrollment_code,
          permanent_status: r.permanent_status,
          ...(visibleCols.includes("Paid Date") ? { paid_date: r.paid_date } : {}),
        },
        q
      );
    });
  }, [rowsTpnd, search, branch, status, visibleCols]);

  const filteredStore = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rowsStore.filter((r) => {
      if (branch && r.branch !== branch) return false;
      if (!q) return true;
      return match(
        {
          branch: r.branch,
          grade: r.grade,
          enrollment_code: r.enrollment_code,
          kit_name: r.kit_name,
          ...(visibleCols.includes("Paid Date") ? { paid_date: r.paid_date } : {}),
        },
        q
      );
    });
  }, [rowsStore, search, branch, visibleCols]);

  const rowCount = tab === "tpnd_installment" ? filteredTpnd.length : filteredStore.length;

  const handleFetchNow = async () => {
    try {
      await fetchNow(tab === "tpnd_installment" ? "tpnd" : "store");
    } catch {
      // error surfaced via fetchError
    }
  };

  const colHeader = (c: string) =>
    tab === "tpnd_installment"
      ? { "Branch Name": "Branch Name", "Paid Date": "Paid Date", "Grade": "Grade", "Enrollment Code": "Enrollment Code", "Permanent Status": "Permanent Status" }[c] ?? c
      : { "Branch": "Branch", "Paid Date": "Paid Date", "Enrollment Code": "Enrollment Code", "Grade": "Grade", "Section": "Section", "Kit Name": "Kit Name", "Quantity": "Quantity", "Amount": "Amount", "Total": "Total", "Receipt No": "Receipt No" }[c] ?? c;

  const renderCell = (c: string, row: HistoricTpndRow | HistoricStoreRow) => {
    if (tab === "tpnd_installment") {
      const r = row as HistoricTpndRow;
      switch (c) {
        case "Branch Name": return r.branch_name;
        case "Paid Date": return r.paid_date ?? "—";
        case "Grade": return r.grade;
        case "Enrollment Code": return r.enrollment_code;
        case "Permanent Status": return r.permanent_status;
        default: return "";
      }
    }
    const r = row as HistoricStoreRow;
    switch (c) {
      case "Branch": return r.branch;
      case "Paid Date": return r.paid_date ?? "—";
      case "Enrollment Code": return r.enrollment_code;
      case "Grade": return r.grade;
      case "Section": return r.section;
      case "Kit Name": return r.kit_name;
      case "Quantity": return String(r.quantity);
      case "Amount": return r.amount.toLocaleString("en-IN");
      case "Total": return r.total.toLocaleString("en-IN");
      case "Receipt No": return r.receipt_no ?? "—";
      default: return "";
    }
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
          Auto-fetched daily at 8:00 AM from Eduvate. Data is stored in the K12 Central database.
        </p>
      </div>

      {/* Report tabs */}
      <div className="historic-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`historic-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => {
              setTab(t.id);
              setSearch("");
              setBranch("");
              setStatus("");
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Last-fetched banner + Fetch Now */}
      <div className="card historic-fetchbar">
        <div className="historic-fetchbar-info">
          <span className={`fetch-dot ${logs[tab]?.last_status === "failed" ? "bad" : logs[tab]?.last_status === "ok" ? "good" : ""}`} />
          <div>
            <div className="fetch-title">
              {tab === "tpnd_installment" ? "TPND Report" : "Store Report - Kit Wise"}
              {logs[tab]?.last_row_count != null && logs[tab].last_row_count > 0 && (
                <span className="row-count" style={{ marginLeft: 10 }}>
                  {logs[tab].last_row_count.toLocaleString("en-IN")} rows
                </span>
              )}
            </div>
            <div className="fetch-sub">
              {logsLoading
                ? "Checking fetch history…"
                : logs[tab]
                  ? `Last fetched ${timeAgo(logs[tab].last_fetched_at)} (${fmtDateTime(logs[tab].last_fetched_at)})${logs[tab].last_report_date ? ` · data for ${logs[tab].last_report_date}` : ""}`
                  : "Never fetched yet — click Fetch Now to pull it from Eduvate."}
              {logs[tab]?.last_status === "failed" && logs[tab]?.last_error && (
                <span className="fetch-err"> · {logs[tab].last_error}</span>
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
              placeholder={
                tab === "tpnd_installment"
                  ? "Search ERP / Branch / Zone…"
                  : "Search ERP / Branch / Zone / Kit Name…"
              }
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
          {tab === "tpnd_installment" && (
            <select
              className="filter-select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by permanent status"
            >
              <option value="">All Statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
        <span className="row-count">
          {dataLoading ? "Loading…" : `${rowCount.toLocaleString("en-IN")} of ${(tab === "tpnd_installment" ? rowsTpnd.length : rowsStore.length).toLocaleString("en-IN")} rows`}
        </span>
      </div>

      {/* Column visibility chips */}
      <div className="historic-colchips">
        <span className="colchips-label">
          <CheckCircleIcon size={13} /> Columns:
        </span>
        {allColumns.map((c) => (
          <button
            key={c}
            className={`colchip ${visibleCols.includes(c) ? "on" : ""}`}
            onClick={() => toggleColumn(c)}
            title={visibleCols.includes(c) ? "Click to hide this column" : "Click to show this column"}
          >
            {c}
          </button>
        ))}
        <button className="link-btn" onClick={resetColumns} style={{ marginLeft: 6 }}>
          Reset
        </button>
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
              {visibleCols.map((c) => (
                <th key={c}>{colHeader(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataLoading && (
              <tr>
                <td colSpan={visibleCols.length + 1} className="table-empty">
                  Loading data…
                </td>
              </tr>
            )}
            {!dataLoading &&
              (tab === "tpnd_installment" ? filteredTpnd : filteredStore)
                .slice(0, 500)
                .map((row, i) => (
                  <tr key={row.id}>
                    <td className="mapping-idx">{i + 1}</td>
                    {visibleCols.map((c) => (
                      <td key={c}>{renderCell(c, row)}</td>
                    ))}
                  </tr>
                ))}
            {!dataLoading && rowCount === 0 && (
              <tr>
                <td colSpan={visibleCols.length + 1} className="table-empty">
                  No rows{search || branch || status ? " match your filters" : " — fetch the report to load data"}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {rowCount > 500 && (
          <div className="table-more-hint">
            Showing first 500 of {rowCount.toLocaleString("en-IN")} matching rows. Use the filters to narrow down.
          </div>
        )}
      </div>

      <div className="historic-footnote">
        <ClockIcon size={13} />
        Auto-fetch runs daily at 8:00 AM IST (Vercel Cron). “Fetch Now” pulls the latest data immediately.
      </div>
    </div>
  );
}
