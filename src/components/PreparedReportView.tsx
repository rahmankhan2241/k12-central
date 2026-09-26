import { useState } from "react";
import type { PreparedReport } from "../prepareReport";
import { exportPreparedExcel } from "../exportExcel";
import {
  AlertIcon,
  CheckCircleIcon,
  DownloadIcon,
  FileReportIcon,
  PlusIcon,
} from "../icons";
import type { BranchZbhMapping } from "../types";
import type { MappingSyncStatus } from "../useBranchZbhMapping";

type PreparedReportViewProps = {
  prepared: PreparedReport;
  onBack: () => void;
  /** Current Branch & ZBH mapping rows (used to detect unmapped plants). */
  mapping: BranchZbhMapping[];
  mappingStatus: MappingSyncStatus;
  /** Persist the mapping (adds + skips applied so far) to Supabase. */
  onAddMappingRows: (rows: BranchZbhMapping[]) => void;
};

function agingClass(days: number): string {
  if (days > 30) return "red";
  if (days > 15) return "amber";
  return "green";
}

export default function PreparedReportView({
  prepared,
  onBack,
  mapping,
  mappingStatus,
  onAddMappingRows,
}: PreparedReportViewProps) {
  const p = prepared;

  // Plants in the pivot whose ZBH is "(Unmapped)"
  const unmappedPlants = p.plantRows
    .filter((r) => r.zbh === "(Unmapped)")
    .map((r) => r.plant);

  const [drafts, setDrafts] = useState<
    Record<string, { zone: string; branchEduvate: string; zbh: string }>
  >({});
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [hintFor, setHintFor] = useState<string | null>(null); // plant missing ZBH

  const pendingPlants = unmappedPlants.filter((pl) => !ignored.has(pl));

  const setDraft = (plant: string, field: "zone" | "branchEduvate" | "zbh", value: string) => {
    setDrafts((d) => ({
      ...d,
      [plant]: {
        zone: d[plant]?.zone ?? "",
        branchEduvate: d[plant]?.branchEduvate ?? "",
        zbh: d[plant]?.zbh ?? "",
        [field]: value,
      },
    }));
  };

  const addPlant = (plant: string) => {
    const draft = drafts[plant];
    const zbh = (draft?.zbh ?? "").trim();
    if (!zbh) {
      setHintFor(plant);
      return; // ZBH is the only mandatory field
    }
    setHintFor(null);
    onAddMappingRows([
      {
        zone: (draft?.zone ?? "").trim(),
        branchSap: plant,
        branchEduvate: (draft?.branchEduvate ?? "").trim(),
        zbh,
      },
    ]);
    setLastAdded(plant);
  };

  const ignorePlant = (plant: string) => {
    setIgnored((s) => {
      const next = new Set(s);
      next.add(plant);
      return next;
    });
  };

  const exportExcel = () => {
    void exportPreparedExcel(p, p.paramsUsed.taproot ? "taproot" : "non-taproot");
  };

  return (
    <div>
      <div className="prepared-hero">
        <div className="prepared-hero-top">
          <div>
            <div className="prepared-kicker">
              <FileReportIcon size={14} />
              Prepared Report
            </div>
            <h2>Pending GRN Summary by Plant</h2>
            <p>
              Period <b>{p.paramsUsed.startDate}</b> → <b>{p.paramsUsed.endDate}</b> · Taproot{" "}
              <b>{p.paramsUsed.taproot ? "Yes" : "No"}</b> · generated{" "}
              {p.generatedAt.toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
          <div className="card-actions">
            <button className="btn ghost-dark" onClick={onBack}>
              ← Back to RAW data
            </button>
            <button className="btn invert" onClick={exportExcel}>
              <DownloadIcon size={14} />
              Export Excel
            </button>
          </div>
        </div>
        <div className="prepared-kpis">
          <div className="kpi">
            <span className="kpi-value">{p.overallDistinctDocs.toLocaleString("en-IN")}</span>
            <span className="kpi-label">Total Pending GRN</span>
          </div>
          <div className="kpi">
            <span className="kpi-value">{p.plantRows.length}</span>
            <span className="kpi-label">Plants</span>
          </div>
          <div className="kpi">
            <span className="kpi-value">
              {p.plantRows[0] ? `${p.plantRows[0].oldestAging} days` : "—"}
            </span>
            <span className="kpi-label">Oldest Aging</span>
          </div>
        </div>
      </div>

      {pendingPlants.length > 0 && (
        <div className="card unmapped-card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div className="card-title">
              <AlertIcon size={16} />
              {pendingPlants.length} plant{pendingPlants.length === 1 ? "" : "s"} not found in
              Branch & ZBH Mapping
            </div>
            <span className="row-count">
              Fill Zone · Branch (Eduvate) · ZBH, then Add — or Skip to ignore
            </span>
          </div>
          <div className="table-wrap">
            <table className="data-table unmapped-table">
              <thead>
                <tr>
                  <th>Plant Name (from file)</th>
                  <th>Zone</th>
                  <th>Branch (Eduvate)</th>
                  <th>ZBH *</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingPlants.map((plant) => {
                  const d = drafts[plant] ?? { zone: "", branchEduvate: "", zbh: "" };
                  return (
                    <tr key={plant} className={lastAdded === plant ? "just-added" : ""}>
                      <td className="pivot-plant">{plant}</td>
                      <td>
                        <input
                          className="cell-edit"
                          value={d.zone}
                          placeholder="e.g. North"
                          onChange={(e) => setDraft(plant, "zone", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="cell-edit"
                          value={d.branchEduvate}
                          placeholder="e.g. OIS Dwarka Sec 19"
                          onChange={(e) => setDraft(plant, "branchEduvate", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="cell-edit"
                          value={d.zbh}
                          placeholder="e.g. ZBH-DL-01"
                          onChange={(e) => setDraft(plant, "zbh", e.target.value)}
                        />
                      </td>
                      <td className="unmapped-actions">
                        <button
                          className="btn success"
                          title="Add to Branch & ZBH Mapping"
                          onClick={() => addPlant(plant)}
                        >
                          <PlusIcon size={13} />
                          Add
                        </button>
                        <button className="btn" onClick={() => ignorePlant(plant)}>
                          Skip
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {hintFor && (
                  <tr className="hint-row">
                    <td colSpan={5} className="table-empty unmapped-hint">
                      Enter a <b>ZBH</b> for <b>{hintFor}</b> to add it to the mapping — Zone and
                      Branch (Eduvate) are optional.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="card-body unmapped-foot">
            Added rows are saved to the cloud mapping{" "}
            {mappingStatus === "saving"
              ? "…saving"
              : mappingStatus === "failed"
              ? "— save FAILED, kept on this device"
              : "and the report refreshes"}{" "}
            ({mapping.length} mapping rows total). Skipped plants stay{" "}
            <span className="pivot-zbh unmapped">(Unmapped)</span> for this report only.
          </div>
        </div>
      )}

      {p.warnings.length > 0 && (
        <div className="validation-banner error">
          <AlertIcon size={16} />
          <div>
            {p.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div className="card-title">
            <CheckCircleIcon size={16} />
            How the data was filtered
          </div>
          <span className="row-count">{p.finalRowCount.toLocaleString("en-IN")} rows kept</span>
        </div>
        <div className="card-body funnel-strip">
          {[
            { label: "RAW rows", value: p.funnel.raw },
            { label: "GR = 0", value: p.funnel.afterZeroGr },
            { label: "In date range", value: p.funnel.afterDate },
            { label: `Taproot ${p.paramsUsed.taproot ? "only" : "excluded"}`, value: p.funnel.afterTaproot },
            { label: "SSPL removed", value: p.funnel.afterSspl },
          ].map((step, i) => (
            <div className="funnel-step" key={step.label}>
              <div className="funnel-value">{step.value.toLocaleString("en-IN")}</div>
              <div className="funnel-label">{step.label}</div>
              {i < 4 && <div className="funnel-arrow">→</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <FileReportIcon size={16} />
            Pivot — Plant Name
          </div>
          <span className="row-count">
            Aging = Today − (Posting Date + 7) · max per plant
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table pivot-table">
            <thead>
              <tr>
                <th>ZBH</th>
                <th>Plant Name</th>
                <th>Total Pending GRN</th>
                <th>Oldest GRN Aging</th>
              </tr>
            </thead>
            <tbody>
              {p.plantRows.map((r) => (
                <tr key={r.plant}>
                  <td className={`pivot-zbh${r.zbh === "(Unmapped)" ? " unmapped" : ""}`}>{r.zbh}</td>
                  <td className="pivot-plant">{r.plant}</td>
                  <td>{r.totalPendingGrn.toLocaleString("en-IN")}</td>
                  <td>
                    <span className={`aging-badge ${agingClass(r.oldestAging)}`}>
                      {r.oldestAging} days
                    </span>
                  </td>
                </tr>
              ))}
              {p.plantRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="table-empty">
                    No rows survived the filters for this period. Adjust the date range in Settings
                    or check the RAW file.
                  </td>
                </tr>
              )}
            </tbody>
            {p.plantRows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={2}>Total</td>
                  <td className="pivot-total">{p.overallDistinctDocs.toLocaleString("en-IN")}</td>
                  <td>—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
