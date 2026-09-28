import { useState } from "react";
import { useHistoricColumns, TPND_ALL_COLUMNS, STORE_ALL_COLUMNS } from "../useHistoricColumns";
import type { HistoricReportKey } from "../useHistoricColumns";
import { CheckCircleIcon, GearIcon } from "../icons";

/**
 * Historic Report settings — choose which columns are visible & filterable
 * for each report. Saved to Supabase immediately.
 */
export default function HistoricColumnsCard() {
  const [report, setReport] = useState<HistoricReportKey>("tpnd_installment");
  const { columns, toggleColumn, resetColumns, status } = useHistoricColumns(report);

  const all = report === "tpnd_installment" ? TPND_ALL_COLUMNS : STORE_ALL_COLUMNS;

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Historic Report Columns</div>
        <span className="row-count">
          {columns.length} of {all.length} shown
          {status === "saving" ? " · saving…" : status === "saved" ? " · saved" : status === "failed" ? " · save failed" : ""}
        </span>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="drawer-hint">
          Pick which columns appear (and are searchable/filterable) on the Historic Report page,
          separately for each report. Changes are saved to the K12 Central database immediately.
        </p>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={`historic-tab ${report === "tpnd_installment" ? "active" : ""}`}
            onClick={() => setReport("tpnd_installment")}
          >
            TPND Report
          </button>
          <button
            className={`historic-tab ${report === "store_kit_wise" ? "active" : ""}`}
            onClick={() => setReport("store_kit_wise")}
          >
            Store Report - Kit Wise
          </button>
        </div>

        <div className="historic-colchips">
          {all.map((c) => (
            <button
              key={c}
              className={`colchip ${columns.includes(c) ? "on" : ""}`}
              onClick={() => toggleColumn(c)}
            >
              {columns.includes(c) && <CheckCircleIcon size={12} />}
              {c}
            </button>
          ))}
        </div>

        <div>
          <button className="btn" onClick={resetColumns}>
            <GearIcon size={14} />
            Reset to defaults
          </button>
        </div>

        {status === "failed" && (
          <div className="upload-error">Could not save to the database — retry by toggling a column.</div>
        )}
      </div>
    </div>
  );
}
