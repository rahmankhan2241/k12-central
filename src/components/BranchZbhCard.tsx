import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useBranchZbhMapping } from "../useBranchZbhMapping";
import { FILE_ACCEPT, getExtension } from "../fileUtils";
import type { BranchZbhMapping } from "../types";
import {
  AlertIcon,
  CheckCircleIcon,
  CloseIcon,
  GearIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from "../icons";

const HEADERS = ["Zone", "Branch (SAP)", "Branch (Eduvate)", "ZBH"];

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_\-.()]/g, "");
}

/** Match an uploaded header to one of our four expected columns. */
function matchHeader(header: string): string | null {
  const h = normalizeKey(header);
  if (h === "zone") return "zone";
  if (h === "branchsap" || h === "sapbranch" || h === "branchsapname") return "branchSap";
  if (h === "brancheduvate" || h === "eduvatebranch" || h === "brancheduvatename") return "branchEduvate";
  if (h === "zbh") return "zbh";
  return null;
}


export default function BranchZbhCard() {
  const { rows, setRows, status, retrySave } = useBranchZbhMapping();
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [newRow, setNewRow] = useState<BranchZbhMapping>({ zone: "", branchSap: "", branchEduvate: "", zbh: "" });
  const [manualError, setManualError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Case-insensitive search across Zone | Branch (SAP) | Branch (Eduvate) | ZBH
  const q = search.trim().toLowerCase();
  const visibleRows = q
    ? rows
        .map((r, originalIndex) => ({ r, originalIndex }))
        .filter(
          ({ r }) =>
            r.zone.toLowerCase().includes(q) ||
            r.branchSap.toLowerCase().includes(q) ||
            r.branchEduvate.toLowerCase().includes(q) ||
            r.zbh.toLowerCase().includes(q)
        )
    : rows.map((r, originalIndex) => ({ r, originalIndex }));

  const handleFile = async (file: File | null | undefined) => {
    setUploadError(null);
    setUploadInfo(null);
    if (!file) return;
    if (!getExtension(file.name)) {
      setUploadError("Unsupported file type. Please upload a .csv, .xlsx or .xls file.");
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: "",
        blankrows: false,
      });
      if (matrix.length < 2) {
        setUploadError("The file appears to have no data rows.");
        return;
      }
      // Map header row to our four fields (any column order)
      const headerRow = matrix[0].map((h) => matchHeader(String(h)));
      const missing = [0, 1, 2, 3].filter((i) => !headerRow.includes(String(i) as never));
      if (headerRow.filter(Boolean).length < 4) {
        setUploadError(
          `Could not find all 4 required columns (Zone, Branch (SAP), Branch (Eduvate), ZBH). Found: ${
            headerRow.filter(Boolean).length
          } of 4.`
        );
        return;
      }
      const idxOf = (field: string) => headerRow.findIndex((h) => h === field);
      const parsed: BranchZbhMapping[] = [];
      for (let r = 1; r < matrix.length; r++) {
        const row = matrix[r];
        const m: BranchZbhMapping = {
          zone: String(row[idxOf("zone")] ?? "").trim(),
          branchSap: String(row[idxOf("branchSap")] ?? "").trim(),
          branchEduvate: String(row[idxOf("branchEduvate")] ?? "").trim(),
          zbh: String(row[idxOf("zbh")] ?? "").trim(),
        };
        if (m.zone || m.branchSap || m.branchEduvate || m.zbh) parsed.push(m);
      }
      if (parsed.length === 0) {
        setUploadError("No data rows found under the header.");
        return;
      }
      void missing;
      setRows(parsed);
      setUploadInfo(`Loaded ${parsed.length} mapping row${parsed.length === 1 ? "" : "s"} from “${file.name}” (replaces the previous list).`);
    } catch {
      setUploadError("Could not read the file. Please check it is a valid Excel/CSV file.");
    }
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Zone", "Branch (SAP)", "Branch (Eduvate)", "ZBH"],
      ["North", "OIS Dwarka Sector-19", "Dwarka 19", "ZBH-DL-01"],
      ["South", "OIS Mysore", "Mysore Main", "ZBH-KA-04"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Branch ZBH Mapping");
    XLSX.writeFile(wb, "Branch_ZBH_Mapping_Template.xlsx");
  };

  const addManualRow = () => {
    setManualError(null);
    const { zone, branchSap, branchEduvate, zbh } = newRow;
    if (!zone && !branchSap && !branchEduvate && !zbh) {
      setManualError("Fill at least one field before adding.");
      return;
    }
    const dup = rows.some(
      (r) =>
        r.branchSap.toLowerCase() === branchSap.trim().toLowerCase() &&
        r.branchEduvate.toLowerCase() === branchEduvate.trim().toLowerCase()
    );
    if (dup) {
      setManualError("This Branch (SAP) + Branch (Eduvate) pair already exists.");
      return;
    }
    setRows([...rows, { zone: zone.trim(), branchSap: branchSap.trim(), branchEduvate: branchEduvate.trim(), zbh: zbh.trim() }]);
    setNewRow({ zone: "", branchSap: "", branchEduvate: "", zbh: "" });
  };

  const updateCell = (index: number, field: keyof BranchZbhMapping, value: string) => {
    setRows(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Branch &amp; ZBH Mapping</div>
        <span className="row-count">
          {rows.length} mapping row{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="drawer-hint">
          Upload an Excel file with columns <b>Zone | Branch (SAP) | Branch (Eduvate) | ZBH</b> to
          replace the mapping in one go, or add rows manually. Everything is stored in the K12
          Central database.
        </p>

        <div
          className={`dropzone compact ${dragOver ? "drag" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="dropzone-icon small">
            <UploadIcon size={20} />
          </div>
          <div>
            <div className="dropzone-title" style={{ fontSize: 14 }}>
              Drop mapping file here
            </div>
            <div className="dropzone-sub" style={{ fontSize: 12 }}>
              or click to browse · columns: Zone | Branch (SAP) | Branch (Eduvate) | ZBH
            </div>
          </div>
          <button
            className="btn"
            style={{ marginTop: 10 }}
            onClick={(e) => {
              e.stopPropagation();
              downloadTemplate();
            }}
          >
            <GearIcon size={14} />
            Download template
          </button>
        </div>

        {uploadError && (
          <div className="upload-error">
            <AlertIcon size={14} />
            {uploadError}
          </div>
        )}
        {uploadInfo && (
          <div className="validation-banner success" style={{ marginBottom: 0 }}>
            <CheckCircleIcon size={15} />
            <div>{uploadInfo}</div>
            <button className="vib-close" onClick={() => setUploadInfo(null)} aria-label="Dismiss">
              <CloseIcon size={13} />
            </button>
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

        {rows.length > 0 && (
          <>
            <div className="table-toolbar">
              <div className="filters">
                <div className="sidebar-search" style={{ width: 260 }}>
                  <span className="search-icon">
                    <SearchIcon size={15} />
                  </span>
                  <input
                    className="table-search"
                    style={{ paddingLeft: 32 }}
                    placeholder="Search branch name or ZBH..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <span className="row-count">
                {q
                  ? `${visibleRows.length} of ${rows.length} rows match “${search.trim()}”`
                  : `${rows.length} rows`}
              </span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="data-table mapping-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    {HEADERS.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ r, originalIndex }, vi) => (
                    <tr key={originalIndex}>
                      <td className="mapping-idx">{q ? vi + 1 : originalIndex + 1}</td>
                      {(["zone", "branchSap", "branchEduvate", "zbh"] as const).map((f) => (
                        <td key={f}>
                          <input
                            className="cell-edit"
                            value={String(r[f])}
                            onChange={(e) => updateCell(originalIndex, f, e.target.value)}
                          />
                        </td>
                      ))}
                      <td>
                        <button
                          className="icon-btn danger"
                          onClick={() => setRows(rows.filter((_, x) => x !== originalIndex))}
                          title="Delete row"
                        >
                          <TrashIcon size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="table-empty">
                        No mapping rows match “{search.trim()}”.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="manual-add">
          {(["zone", "branchSap", "branchEduvate", "zbh"] as const).map((f) => (
            <input
              key={f}
              placeholder={HEADERS[["zone", "branchSap", "branchEduvate", "zbh"].indexOf(f)]}
              value={newRow[f]}
              onChange={(e) => setNewRow({ ...newRow, [f]: e.target.value })}
            />
          ))}
          <button className="btn primary" onClick={addManualRow}>
            <PlusIcon size={14} />
            Add
          </button>
        </div>
        {manualError && (
          <div className="upload-error">
            <AlertIcon size={14} />
            {manualError}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
