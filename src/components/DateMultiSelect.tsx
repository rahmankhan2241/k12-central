import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronIcon } from "./YearDropdownIcons";

/**
 * Excel-style DATE filter (cascading):
 *
 *   ▾ top level = months ("Jan 2026"), each with a checkbox that selects the
 *     WHOLE month, and a [+] expander that reveals every individual date in
 *     that month ("15 Jan 2026") for fine-grained picking.
 *
 *   • Select all / Clear / Invert act across months and dates, like the other
 *     Excel-style dropdowns on this page.
 *   • Checking a month collapses it to month-level; unchecking one date under
 *     a checked month "splits" it into individually selected dates.
 *   • A month checkbox shows indeterminate (dash) when only some of its dates
 *     are selected.
 *   • Search matches month names, date labels and raw yyyy-mm-dd text, and
 *     auto-expands the months that have matches.
 *
 * The parent cascades the options: pass months/dates derived from rows that
 * match every OTHER filter. Selections are never pruned (an option may vanish
 * while selected, and can still be unselected) — same contract as MultiSelect.
 */

export type DateSelection = {
  /** Fully-selected months, "yyyy-mm". A row matches if its month is here. */
  months: string[];
  /** Individually selected dates, "yyyy-mm-dd", in months NOT fully selected. */
  dates: string[];
};

export const EMPTY_DATE_SELECTION: DateSelection = { months: [], dates: [] };

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-01" → "Jan 2026" */
export function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTH_NAMES[m - 1] ? `${MONTH_NAMES[m - 1]} ${ym.slice(0, 4)}` : ym;
}

/** "2026-01-15" → "15 Jan 2026" */
export function dateLabel(ymd: string): string {
  const d = Number(ymd.slice(8, 10));
  const m = Number(ymd.slice(5, 7));
  return MONTH_NAMES[m - 1] ? `${d} ${MONTH_NAMES[m - 1]} ${ymd.slice(0, 4)}` : ymd;
}

export default function DateMultiSelect({
  label,
  months,
  datesByMonth,
  selected,
  onChange,
  ariaLabel,
}: {
  label: string;
  /** Available months, ascending "yyyy-mm". */
  months: string[];
  /** Available dates per month, ascending "yyyy-mm-dd". */
  datesByMonth: Record<string, string[]>;
  selected: DateSelection;
  onChange: (next: DateSelection) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  const datesFor = (m: string): string[] => datesByMonth[m] ?? [];

  const isMonthChecked = (m: string): boolean =>
    selected.months.includes(m) ||
    (datesFor(m).length > 0 && datesFor(m).every((d) => selected.dates.includes(d)));

  const isMonthIndeterminate = (m: string): boolean =>
    !isMonthChecked(m) && datesFor(m).some((d) => selected.dates.includes(d));

  // Search: months matching by name/label, or having matching dates.
  // While searching, every month with a hit is auto-expanded.
  const visibleMonths = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return months;
    return months.filter(
      (m) =>
        monthLabel(m).toLowerCase().includes(q) ||
        m.includes(q) ||
        datesFor(m).some((d) => dateLabel(d).toLowerCase().includes(q) || d.includes(q))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, datesByMonth, query]);

  const isSearching = query.trim().length > 0;
  const monthOpen = (m: string): boolean => (isSearching ? true : expanded.has(m));

  const toggleExpand = (m: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const toggleMonth = (m: string) => {
    const ds = datesFor(m);
    if (isMonthChecked(m)) {
      // Unselect the whole month (whether month-level or via all its dates).
      onChange({
        months: selected.months.filter((x) => x !== m),
        dates: selected.dates.filter((d) => !ds.includes(d)),
      });
    } else {
      // Select the whole month; drop any partial date picks inside it.
      onChange({
        months: [...selected.months, m],
        dates: selected.dates.filter((d) => !ds.includes(d)),
      });
    }
  };

  const toggleDate = (m: string, d: string) => {
    const ds = datesFor(m);
    if (selected.months.includes(m)) {
      // Splitting a checked month: every date EXCEPT this one, individually.
      onChange({
        months: selected.months.filter((x) => x !== m),
        dates: [...selected.dates, ...ds.filter((x) => x !== d)],
      });
      return;
    }
    let dates = selected.dates.includes(d)
      ? selected.dates.filter((x) => x !== d)
      : [...selected.dates, d];
    let months = selected.months;
    // All dates of the month now picked → collapse to month-level.
    if (ds.length > 0 && ds.every((x) => dates.includes(x))) {
      months = [...months, m];
      dates = dates.filter((x) => !ds.includes(x));
    }
    onChange({ months, dates });
  };

  const selectAll = () => onChange({ months: [...months], dates: [] });
  const clearAll = () => onChange(EMPTY_DATE_SELECTION);

  // Invert across BOTH levels: each month's effective selection flips to its
  // complement; months that end up fully selected collapse to month-level.
  const invert = () => {
    const outMonths: string[] = [];
    const outDates: string[] = [];
    for (const m of months) {
      const ds = datesFor(m);
      const chosen = selected.months.includes(m)
        ? new Set(ds)
        : new Set(ds.filter((d) => selected.dates.includes(d)));
      const flipped = ds.filter((d) => !chosen.has(d));
      if (ds.length > 0 && flipped.length === ds.length) outMonths.push(m);
      else outDates.push(...flipped);
    }
    onChange({ months: outMonths, dates: outDates });
  };

  const totalDates = months.reduce((n, m) => n + datesFor(m).length, 0);
  const allSelected =
    months.length > 0 &&
    selected.dates.length === 0 &&
    selected.months.length === months.length;

  const summary = (() => {
    const mCount = selected.months.length;
    const dCount = selected.dates.length;
    if (mCount === 0 && dCount === 0) return label;
    if (allSelected) return `${label.replace(/^All /, "All ")} (all)`;
    const parts: string[] = [];
    if (mCount === 1) parts.push(monthLabel(selected.months[0]));
    else if (mCount > 1) parts.push(`${mCount} months`);
    if (dCount === 1) parts.push(dateLabel(selected.dates[0]));
    else if (dCount > 1) parts.push(`${dCount} dates`);
    return parts.join(" + ");
  })();

  return (
    <div className="msel" ref={ref}>
      <button
        type="button"
        className={`msel-btn ${summary !== label ? "active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={summary !== label ? summary : undefined}
      >
        <span className="msel-text" title={summary}>{summary}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="msel-menu msel-menu-wide" role="listbox" aria-multiselectable="true">
          <div className="msel-search">
            <input
              placeholder="Search month or date…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="msel-actions">
            <button
              type="button"
              className="link-btn"
              onClick={selectAll}
              disabled={months.length === 0 || allSelected}
              title="Check every month"
            >
              Select all
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={clearAll}
              disabled={selected.months.length === 0 && selected.dates.length === 0}
              title="Uncheck everything (no date filter)"
            >
              Clear
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={invert}
              disabled={months.length === 0}
              title="Check only what is currently unchecked"
            >
              Invert
            </button>
          </div>
          <div className="msel-list">
            {visibleMonths.map((m) => {
              const ds = datesFor(m);
              const checked = isMonthChecked(m);
              const ind = isMonthIndeterminate(m);
              const isOpen = monthOpen(m);
              return (
                <div key={m} className="msel-month">
                  <div className={`msel-item msel-month-row ${isOpen ? "open" : ""}`}>
                    <button
                      type="button"
                      className="msel-expander"
                      aria-label={isOpen ? `Collapse ${monthLabel(m)}` : `Expand ${monthLabel(m)}`}
                      aria-expanded={isOpen}
                      onClick={() => toggleExpand(m)}
                      title={isOpen ? "Hide dates" : "Show all dates in this month"}
                    >
                      {isOpen ? "−" : "+"}
                    </button>
                    <input
                      type="checkbox"
                      checked={checked}
                      ref={(el) => {
                        if (el) el.indeterminate = ind;
                      }}
                      onChange={() => toggleMonth(m)}
                      aria-label={`Select all dates in ${monthLabel(m)}`}
                    />
                    <span onClick={() => toggleExpand(m)} style={{ cursor: "pointer" }}>
                      {monthLabel(m)}
                      <span className="msel-count">({ds.length})</span>
                    </span>
                  </div>
                  {isOpen && (
                    <div className="msel-sublist" role="group" aria-label={`Dates in ${monthLabel(m)}`}>
                      {ds.map((d) => (
                        <label key={d} className="msel-item msel-sub">
                          <input
                            type="checkbox"
                            checked={checked || selected.dates.includes(d)}
                            onChange={() => toggleDate(m, d)}
                          />
                          <span>
                            {dateLabel(d)}
                            {checked && <span className="msel-count">(via month)</span>}
                          </span>
                        </label>
                      ))}
                      {ds.length === 0 && <div className="msel-empty">No dates</div>}
                    </div>
                  )}
                </div>
              );
            })}
            {visibleMonths.length === 0 && <div className="msel-empty">No matches</div>}
          </div>
          <div className="msel-foot">
            {totalDates.toLocaleString("en-IN")} dates across {months.length} month
            {months.length === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}
