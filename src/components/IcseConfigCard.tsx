import { useMemo, useState } from "react";
import { useIcseConfig } from "../useIcseConfig";
import type { IcseRule } from "../useIcseConfig";
import { AlertIcon, GearIcon, PlusIcon, TrashIcon } from "../icons";

/**
 * ICSE Configuration (Settings → Historic Report Related).
 * A rule is a Branch Name + Grade pair: on the Historic Report page, any row
 * matching BOTH is labeled ICSE, everything else OIS. Rows are editable
 * inline and saved to the K12 Central database immediately.
 */
export default function IcseConfigCard() {
  const { rows, setRows, status, retrySave } = useIcseConfig();
  const [newRow, setNewRow] = useState<IcseRule>({ branch: "", grade: "" });
  const [error, setError] = useState<string | null>(null);

  const statusLabel =
    status === "saving"
      ? " · saving…"
      : status === "saved"
        ? " · saved"
        : status === "failed"
          ? " · save failed"
          : "";

  const addRow = () => {
    setError(null);
    const branch = newRow.branch.trim();
    const grade = newRow.grade.trim();
    if (!branch || !grade) {
      setError("Fill both Branch Name and Grade before adding.");
      return;
    }
    const dup = rows.some(
      (r) => r.branch.trim().toLowerCase() === branch.toLowerCase() && r.grade.trim().toLowerCase() === grade.toLowerCase()
    );
    if (dup) {
      setError("This Branch Name + Grade pair already exists.");
      return;
    }
    setRows([...rows, { branch, grade }]);
    setNewRow({ branch: "", grade: "" });
  };

  const updateCell = (index: number, field: keyof IcseRule, value: string) => {
    setRows(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const deleteRow = (index: number) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const summary = useMemo(() => {
    if (rows.length === 0) return "No ICSE rules yet — every student will show as OIS.";
    const branches = new Set(rows.map((r) => r.branch.trim().toLowerCase()));
    return `${rows.length} rule${rows.length === 1 ? "" : "s"} across ${branches.size} branch${branches.size === 1 ? "" : "es"}.`;
  }, [rows]);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">ICSE Configuration</div>
        <span className="row-count">
          {rows.length} rule{rows.length === 1 ? "" : "s"}
          {statusLabel}
        </span>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="drawer-hint">
          A row on the Historic Report page is labeled <b>ICSE</b> when its Branch Name AND Grade
          match a rule here (exactly this grade, other grades stay <b>OIS</b>). Example:{" "}
          <i>BTM Annex + Grade 6</i> makes BTM Annex Grade 6 ICSE while Grade 1/2/… remain OIS.
        </p>

        {rows.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 340 }}>
            <table className="data-table mapping-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Branch Name</th>
                  <th>Grade</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.branch}|${r.grade}|${i}`}>
                    <td className="mapping-idx">{i + 1}</td>
                    <td>
                      <input
                        className="cell-edit"
                        value={r.branch}
                        placeholder="e.g. BTM Annex"
                        onChange={(e) => updateCell(i, "branch", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="cell-edit"
                        value={r.grade}
                        placeholder="e.g. Grade 6"
                        onChange={(e) => updateCell(i, "grade", e.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        className="icon-btn danger"
                        onClick={() => deleteRow(i)}
                        title="Delete rule"
                      >
                        <TrashIcon size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="manual-add">
          <input
            placeholder="Branch Name (e.g. BTM Annex)"
            value={newRow.branch}
            onChange={(e) => setNewRow({ ...newRow, branch: e.target.value })}
          />
          <input
            placeholder="Grade (e.g. Grade 6)"
            value={newRow.grade}
            onChange={(e) => setNewRow({ ...newRow, grade: e.target.value })}
          />
          <button className="btn primary" onClick={addRow}>
            <PlusIcon size={14} />
            Add
          </button>
        </div>
        {error && (
          <div className="upload-error">
            <AlertIcon size={14} />
            {error}
          </div>
        )}
        {status === "failed" && (
          <div className="upload-error">
            <AlertIcon size={14} />
            Could not save to the database. Your change is kept here until it succeeds.
            <button className="link-btn" onClick={retrySave}>
              Retry now
            </button>
          </div>
        )}

        <div className="historic-footnote">
          <GearIcon size={13} />
          {summary}
        </div>
      </div>
    </div>
  );
}
