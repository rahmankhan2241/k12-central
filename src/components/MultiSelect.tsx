import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronIcon } from "./YearDropdownIcons";

/**
 * Multi-select filter dropdown: a button showing the current selection
 * ("All Branches" / one value / "3 selected"), opening a checkbox popover
 * with search, Select all / Clear, and per-item checkboxes. Options are
 * cross-cascaded by the parent — whatever it passes in is listed.
 */
export default function MultiSelect({
  label, // placeholder when nothing is selected, e.g. "All Branches"
  options,
  selected,
  onChange,
  ariaLabel,
}: {
  label: string;
  options: string[];
  selected: string[]; // empty array = no filter (all values)
  onChange: (next: string[]) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  // Excel-style: keep selections even if another filter makes them produce no
  // rows — unchecking must stay possible, so options never prune the selection.

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  };

  const allSelected = options.length > 0 && selected.length === options.length;
  const summary = allSelected
    ? `${label.replace(/^All /, "All ")} (all)`
    : selected.length === 0
      ? label
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <div className="msel" ref={ref}>
      <button
        type="button"
        className={`msel-btn ${selected.length > 0 ? "active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={selected.length > 1 ? selected.join(", ") : undefined}
      >
        <span className="msel-text" title={summary}>{summary}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="msel-menu" role="listbox" aria-multiselectable="true">
          {options.length > 8 && (
            <div className="msel-search">
              <input
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          <div className="msel-actions">
            <button
              type="button"
              className="link-btn"
              onClick={() => onChange([...options])}
              disabled={options.length === 0 || selected.length === options.length}
              title="Check every option"
            >
              Select all
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              title="Uncheck everything (no filter)"
            >
              Clear
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                const alive = new Set(visible);
                const next = options.filter(
                  (o) => alive.has(o) !== selected.includes(o)
                );
                onChange(next);
              }}
              disabled={visible.length === 0}
              title="Check only what is currently unchecked"
            >
              Invert
            </button>
          </div>
          <div className="msel-list">
            {visible.map((opt) => (
              <label key={opt} className="msel-item">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                />
                <span>{opt}</span>
              </label>
            ))}
            {visible.length === 0 && <div className="msel-empty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
