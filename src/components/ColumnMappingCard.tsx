import { useState } from "react";
import { normalizeColumn } from "../reportConfig";
import type { SyncStatus } from "../useReportConfig";
import {
  AlertIcon,
  CheckCircleIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "../icons";

type ColumnMappingCardProps = {
  columns: string[];
  syncStatus: SyncStatus;
  onRetrySave: () => void;
  onChangeColumns: (columns: string[]) => void;
};

export default function ColumnMappingCard({
  columns,
  syncStatus,
  onRetrySave,
  onChangeColumns,
}: ColumnMappingCardProps) {
  const [newColumn, setNewColumn] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isDuplicate = (name: string, ignoreIndex: number | null = null) =>
    columns.some((c, i) => i !== ignoreIndex && normalizeColumn(c) === normalizeColumn(name));

  const addColumn = () => {
    const name = newColumn.trim();
    setError(null);
    if (!name) {
      setError("Type a column name first, then click Add.");
      return;
    }
    if (isDuplicate(name)) {
      setError(`“${name}” already exists in the mapping.`);
      return;
    }
    onChangeColumns([...columns, name]);
    setNewColumn("");
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditValue(columns[index]);
    setError(null);
  };

  const saveEdit = () => {
    const name = editValue.trim();
    setError(null);
    if (editingIndex === null) return;
    if (!name) {
      setError("Column name cannot be empty.");
      return;
    }
    if (isDuplicate(name, editingIndex)) {
      setError(`“${name}” already exists in the mapping.`);
      return;
    }
    onChangeColumns(columns.map((c, i) => (i === editingIndex ? name : c)));
    setEditingIndex(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditValue("");
    setError(null);
  };

  const removeColumn = (index: number) => {
    onChangeColumns(columns.filter((_, i) => i !== index));
    setError(null);
    if (editingIndex === index) cancelEdit();
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Column Mapping</div>
        <span className="row-count">
          {columns.length} column{columns.length === 1 ? "" : "s"} expected
        </span>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="drawer-hint">
          Define the columns expected in the GRN RAW file. Uploads are validated against this list
          (case-insensitive). Changes are saved to the K12 Central database immediately.
        </p>

        <div className="column-add">
          <input
            type="text"
            placeholder="Add expected column (e.g. Dispatch Qty)"
            value={newColumn}
            onChange={(e) => {
              setNewColumn(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && addColumn()}
          />
          <button
            className="btn primary"
            onClick={addColumn}
            title={newColumn.trim() ? "Add this column" : "Type a column name first"}
          >
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

        {syncStatus === "failed" && (
          <div className="upload-error">
            <AlertIcon size={14} />
            Could not save to the database. Your change is kept here until it succeeds.
            <button className="link-btn" onClick={onRetrySave}>
              Retry now
            </button>
          </div>
        )}

        <div className="column-list">
          {columns.map((col, i) => (
            <div className="column-row" key={i}>
              <span className="column-order">{i + 1}</span>
              {editingIndex === i ? (
                <>
                  <input
                    className="column-edit"
                    value={editValue}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                  />
                  <button className="icon-btn success" onClick={saveEdit} title="Save">
                    <CheckCircleIcon size={15} />
                  </button>
                  <button className="icon-btn" onClick={cancelEdit} title="Cancel">
                    <CloseIcon size={14} />
                  </button>
                </>
              ) : (
                <>
                  <span className="column-name" title={col}>
                    {col}
                  </span>
                  <button className="icon-btn" onClick={() => startEdit(i)} title="Rename column">
                    <PencilIcon size={14} />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => removeColumn(i)}
                    title="Remove column"
                  >
                    <TrashIcon size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
          {columns.length === 0 && (
            <div className="column-empty">
              No expected columns configured. Add columns above so uploads can be validated.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
