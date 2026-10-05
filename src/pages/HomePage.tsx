import { FileReportIcon } from "../icons";
import { useAuth } from "../useAuth";

type HomePageProps = {
  onNavigate: (id: string) => void;
};

export default function HomePage({ onNavigate }: HomePageProps) {
  const { canAccess } = useAuth();
  const showPendingGrn = canAccess("pending-grn");
  const showLogisticsSoon =
    canAccess("vendors") || canAccess("shipments") || canAccess("inventory");

  return (
    <div>
      <div className="home-hero">
        <div className="home-hero-kicker">Logistics Operations Console</div>
        <h1>Welcome to K12 Central System</h1>
        <p>
          One place for everything logistics — reports, vendors, shipments and
          inventory. Start by generating the Pending GRN Report from your RAW
          file.
        </p>
      </div>
      <div className="home-cards">
        {showPendingGrn && (
          <button className="card home-card" onClick={() => onNavigate("pending-grn")}>
            <div className="home-card-top">
              <div className="home-card-icon blue">
                <FileReportIcon size={20} />
              </div>
              <span className="badge amber">New</span>
            </div>
            <h3>Pending GRN Report</h3>
            <p>Upload a RAW CSV/XLSX file and instantly view all pending goods receipts in a clean, searchable table.</p>
          </button>
        )}
        {showLogisticsSoon && (
          <div className="card home-card" style={{ cursor: "default", opacity: 0.75 }}>
            <div className="home-card-top">
              <div className="home-card-icon green">🚚</div>
              <span className="badge green">Soon</span>
            </div>
            <h3>Shipments &amp; Vendors</h3>
            <p>Track deliveries, manage vendor master data and monitor logistics performance — coming to this console soon.</p>
          </div>
        )}
      </div>
    </div>
  );
}
