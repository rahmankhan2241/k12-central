import { useState } from "react";
import ColumnMappingCard from "../components/ColumnMappingCard";
import BranchZbhCard from "../components/BranchZbhCard";
import { useReportConfig } from "../useReportConfig";
import { ClockIcon, GearIcon } from "../icons";

type SectionId = "pending-grn" | "future";

const SECTIONS: { id: SectionId; label: string; available: boolean }[] = [
  { id: "pending-grn", label: "Pending GRN Related", available: true },
  { id: "future", label: "More sections (coming soon)", available: false },
];

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>("pending-grn");
  const {
    columns,
    setColumns,
    status,
    retrySave,
  } = useReportConfig();

  return (
    <div className="settings-page">
      <div className="page-head">
        <h1 className="page-title">
          <span className="title-chip">
            <GearIcon size={19} />
          </span>
          Settings
        </h1>
        <p className="page-subtitle">
          Configure mappings and report behavior. Everything is saved to the K12 Central database.
        </p>
      </div>

      <div className="settings-layout">
        <nav className="card settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item ${section === s.id ? "active" : ""} ${
                s.available ? "" : "disabled"
              }`}
              onClick={() => s.available && setSection(s.id)}
              disabled={!s.available}
            >
              {s.available ? <GearIcon size={15} /> : <ClockIcon size={15} />}
              {s.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {section === "pending-grn" && (
            <>
              <ColumnMappingCard
                columns={columns}
                syncStatus={status}
                onRetrySave={retrySave}
                onChangeColumns={setColumns}
              />
              <BranchZbhCard />
            </>
          )}
          {section === "future" && (
            <div className="card">
              <div className="placeholder">
                <div className="placeholder-icon">
                  <ClockIcon size={30} />
                </div>
                <h2>More settings coming soon</h2>
                <p>Additional configuration sections will appear here as the suite grows.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
