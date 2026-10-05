import { useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import Sidebar from "./components/Sidebar";
import HomePage from "./pages/HomePage";
import PendingGrnPage from "./pages/PendingGrnPage";
import HistoricReportPage from "./pages/HistoricReportPage";
import PoPage from "./pages/PoPage";
import SettingsPage from "./pages/SettingsPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import LoginScreen from "./components/LoginScreen";
import { HistoricProvider, useHistoricGlobal } from "./useHistoricFetch";
import { AuthProvider, useAuth } from "./useAuth";
import { normalizeUsername } from "./users";
import { K12Logo, LockIcon, LogoutIcon, MenuIcon } from "./icons";

const PAGE_TITLES: Record<string, string> = {
  vendors: "Vendors",
  shipments: "Shipments",
  inventory: "Inventory",
};

/**
 * Overlay for the Historic Report fetch/load — rendered ONLY while the user is
 * on the Historic Report page. Other pages stay completely normal while data
 * keeps loading (or a fetch keeps running) in the background.
 */
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

function initials(name: string): string {
  const cleaned = name.replace(/[^a-z0-9]/gi, "");
  return (cleaned.slice(0, 2) || "U").toUpperCase();
}

function AccessDenied({ onBack }: { onBack: () => void }) {
  return (
    <div className="card">
      <div className="placeholder">
        <div className="placeholder-icon">
          <LockIcon size={30} />
        </div>
        <h2>This module isn&apos;t enabled for your account</h2>
        <p>Ask the admin to grant access from Settings → Access &amp; Security.</p>
        <button className="btn primary" onClick={onBack}>
          Back to my modules
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const { session, canAccess, logout } = useAuth();
  // Restricted users land on their first allowed module instead of an empty Home.
  const [activePage, setActivePage] = useState(() =>
    session && !session.isAdmin ? session.modules[0] ?? "home" : "home"
  );
  const [collapsed, setCollapsed] = useState(false);

  if (!session) return null;

  const homePage = session.isAdmin ? "home" : session.modules[0] ?? "home";

  let pageContent: ReactNode;
  if (!canAccess(activePage)) {
    pageContent = <AccessDenied onBack={() => setActivePage(homePage)} />;
  } else if (activePage === "home") {
    pageContent = <HomePage onNavigate={setActivePage} />;
  } else if (activePage === "pending-grn") {
    pageContent = <PendingGrnPage />;
  } else if (activePage === "historic-report") {
    pageContent = <HistoricReportPage />;
  } else if (activePage === "po-tracking") {
    pageContent = <PoPage />;
  } else if (activePage === "settings") {
    pageContent = <SettingsPage />;
  } else {
    pageContent = <PlaceholderPage title={PAGE_TITLES[activePage] ?? activePage} />;
  }

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
          <div className="header-user">
            <div className="avatar" title={session.username}>
              {initials(session.username)}
            </div>
            <div className="header-user-meta">
              <span className="header-user-name">{session.username}</span>
              <span className="header-user-role">{session.isAdmin ? "Admin" : "User"}</span>
            </div>
            <button className="btn header-signout" onClick={logout} title="Sign out">
              <LogoutIcon size={15} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <div className="app-body">
        <Sidebar
          collapsed={collapsed}
          activePage={activePage}
          onNavigate={setActivePage}
          canAccess={canAccess}
        />
        <main className="main">
          <div className="page">{pageContent}</div>
        </main>
      </div>
      {/* Loader only on the Historic Report page — background loading stays invisible elsewhere. */}
      {activePage === "historic-report" && <GlobalLoader />}
    </div>
  );
}

function Root() {
  const { ready, session, users } = useAuth();

  if (!ready) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  }

  // A stored session for an account the admin deleted is treated as signed out
  // immediately (the auth provider also clears it from storage).
  const sessionUserExists =
    session &&
    (session.isAdmin ||
      users.some((u) => normalizeUsername(u.username) === normalizeUsername(session.username)));
  if (!session || !sessionUserExists) return <LoginScreen />;

  return <Shell />;
}

export default function App() {
  return (
    <AuthProvider>
      <HistoricProvider>
        <Root />
      </HistoricProvider>
    </AuthProvider>
  );
}
