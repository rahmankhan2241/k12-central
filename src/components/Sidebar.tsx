import { useMemo, useState } from "react";
import type { NavItem } from "../types";
import {
  DashboardIcon,
  FileReportIcon,
  ClockIcon,
  UploadIcon,
  SearchIcon,
  GearIcon,
} from "../icons";

type SidebarProps = {
  collapsed: boolean;
  activePage: string;
  onNavigate: (id: string) => void;
};

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "General",
    items: [{ id: "home", label: "Home", icon: <DashboardIcon /> }],
  },
  {
    label: "Reports",
    items: [
      {
        id: "pending-grn",
        label: "Pending GRN Report",
        icon: <FileReportIcon />,
        badge: "New",
        keywords: ["grn", "goods", "receipt", "note", "pending", "report"],
      },
    ],
  },
  {
    label: "Logistics (Coming Soon)",
    items: [
      { id: "vendors", label: "Vendors", icon: <ClockIcon />, keywords: ["vendor", "supplier", "party"] },
      { id: "shipments", label: "Shipments", icon: <UploadIcon />, keywords: ["shipment", "delivery", "dispatch"] },
      { id: "inventory", label: "Inventory", icon: <UploadIcon />, keywords: ["inventory", "stock", "warehouse"] },
    ],
  },
  {
    label: "System",
    items: [
      {
        id: "settings",
        label: "Settings",
        icon: <GearIcon />,
        keywords: ["settings", "config", "configuration", "mapping", "columns"],
      },
    ],
  },
];

export default function Sidebar({ collapsed, activePage, onNavigate }: SidebarProps) {
  const [query, setQuery] = useState("");

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_SECTIONS;
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        const haystack = [item.label, ...(item.keywords ?? [])].join(" ").toLowerCase();
        return q.split(/\s+/).every((word) => haystack.includes(word));
      }),
    })).filter((section) => section.items.length > 0);
  }, [query]);

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-head">
        <div className="sidebar-search">
          <span className="search-icon">
            <SearchIcon size={15} />
          </span>
          <input
            type="text"
            placeholder={collapsed ? "" : "Search menu..."}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search navigation"
          />
        </div>
      </div>
      <nav className="sidebar-nav">
        {filteredSections.length === 0 && (
          <div className="sidebar-section-label">No matches found</div>
        )}
        {filteredSections.map((section) => (
          <div key={section.label}>
            <div className="sidebar-section-label">{section.label}</div>
            {section.items.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${activePage === item.id ? "active" : ""}`}
                onClick={() => onNavigate(item.id)}
                title={item.label}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                {item.badge && <span className="nav-badge">{item.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">K12 Central · Logistics Suite v0.1</div>
    </aside>
  );
}
