import { useEffect, useState } from "react";
import type { ReportParams } from "../useReportParams";
import { CloseIcon, GearIcon } from "../icons";

type ReportParamsModalProps = {
  open: boolean;
  params: ReportParams;
  onSave: (params: ReportParams) => void;
  onClose: () => void;
};

function todayMinus10(): string {
  return new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function ReportParamsModal({
  open,
  params,
  onSave,
  onClose,
}: ReportParamsModalProps) {
  const [draft, setDraft] = useState<ReportParams>(params);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form with current saved values each time it opens
  useEffect(() => {
    if (open) {
      setDraft(params);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const invalidRange = draft.startDate > draft.endDate;

  const ok = () => {
    if (!draft.startDate || !draft.endDate) {
      setError("Both Start Date and End Date are required.");
      return;
    }
    if (invalidRange) {
      setError("End Date must be on or after Start Date.");
      return;
    }
    onSave(draft);
    onClose();
  };

  const resetDefaults = () => {
    setDraft({ startDate: "2026-01-01", endDate: todayMinus10(), taproot: false });
    setError(null);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Report settings">
        <div className="modal-head">
          <h3>
            <GearIcon size={18} />
            Report Settings
          </h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div className="param-grid">
            <label className="param-field">
              <span className="param-label">Start Date</span>
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => {
                  setDraft({ ...draft, startDate: e.target.value });
                  setError(null);
                }}
              />
            </label>
            <label className="param-field">
              <span className="param-label">End Date</span>
              <input
                type="date"
                value={draft.endDate}
                onChange={(e) => {
                  setDraft({ ...draft, endDate: e.target.value });
                  setError(null);
                }}
              />
            </label>
          </div>
          <div className="param-field">
            <span className="param-label">Taproot</span>
            <div className="seg-group" role="group" aria-label="Taproot">
              <button
                type="button"
                className={`seg-btn ${!draft.taproot ? "active" : ""}`}
                onClick={() => setDraft({ ...draft, taproot: false })}
              >
                No
              </button>
              <button
                type="button"
                className={`seg-btn ${draft.taproot ? "active" : ""}`}
                onClick={() => setDraft({ ...draft, taproot: true })}
              >
                Yes
              </button>
            </div>
          </div>
          {(error || invalidRange) && (
            <div className="upload-error">
              {error ?? "End Date must be on or after Start Date."}
            </div>
          )}
          <p className="param-note">
            Defaults: Start 01-01-2026 · End today−10 · Taproot No. Settings are stored in the K12
            Central database.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={resetDefaults}>
            Reset defaults
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn success" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
