import { useState } from "react";
import { createPortal } from "react-dom";
import Sidebar from "./components/Sidebar";
import HomePage from "./pages/HomePage";
import PendingGrnPage from "./pages/PendingGrnPage";
import HistoricReportPage from "./pages/HistoricReportPage";
import SettingsPage from "./pages/SettingsPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import { HistoricProvider, useHistoricGlobal } from "./useHistoricFetch";
import { K12Logo, MenuIcon } from "./icons";

const PAGE_TITLES: Record<string, string> = {
  vendors: "Vendors",
  shipments: "Shipments",
  inventory: "Inventory",
};

/** Global overlay: shows while fetching/loading data, on every page, without blocking navigation. */
function GlobalLoader() {
  const { fetchPhase, fetchProgress } = useHistoricGlobal();
  if (fetchPhase === "idle") return null;
  // Portal to <body> so centering can't be affected by transformed ancestors.
  return createPortal(
    <div className="global-loader" role="status" aria-live="polite">
      <div className="global-loader-card">
        <span className="spinner" aria-hidden="true" />
        <div className="global-loader-title">
          {fetchPhase === "fetching" ? "Fetching report from Eduvate…" : "Loading report data…"}
        </div>
        {fetchProgress && <div className="global-loader-sub">{fetchProgress}</div>}
        <div className="global-loader-hint">You can keep using other pages — this continues in the background.</div>
      </div>
    </div>,
    document.body
  );
}

function Shell() {
  const [activePage, setActivePage] = useState("home");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <button
            className="header-menu-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            aria-label="Toggle navigation"
          >
            <MenuIcon size={19} />
          </button>
          <div className="header-brand">
            <K12Logo size={38} />
            <div className="header-titles">
              <span className="header-title">K12 Techno Services</span>
              <span className="header-subtitle">Central System</span>
            </div>
          </div>
        </div>
        <div className="header-right">
          <span className="header-date">
            {new Date().toLocaleDateString("en-IN", {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          <div className="avatar" title="Logistics Ops">
            LO
          </div>
        </div>
      </header>
      <div className="app-body">
        <Sidebar
          collapsed={collapsed}
          activePage={activePage}
          onNavigate={setActivePage}
        />
        <main className="main">
          <div className="page">
            {activePage === "home" && <HomePage onNavigate={setActivePage} />}
            {activePage === "pending-grn" && (
              <PendingGrnPage />
            )}
            {activePage === "historic-report" && <HistoricReportPage />}
            {activePage === "settings" && <SettingsPage />}
            {activePage !== "home" &&
              activePage !== "pending-grn" &&
              activePage !== "historic-report" &&
              activePage !== "settings" && (
                <PlaceholderPage title={PAGE_TITLES[activePage] ?? activePage} />
              )}
          </div>
        </main>
      </div>
      <GlobalLoader />
    </div>
  );
}

export default function App() {
  return (
    <HistoricProvider>
      <Shell />
    </HistoricProvider>
  );
}
