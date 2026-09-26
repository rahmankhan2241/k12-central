import { ClockIcon } from "../icons";

type PlaceholderPageProps = {
  title: string;
};

export default function PlaceholderPage({ title }: PlaceholderPageProps) {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{title}</h1>
      </div>
      <div className="card">
        <div className="placeholder">
          <div className="placeholder-icon">
            <ClockIcon size={30} />
          </div>
          <h2>{title} — Coming Soon</h2>
          <p>
            This module is part of the K12 Central logistics suite and will be
            available in an upcoming release.
          </p>
        </div>
      </div>
    </div>
  );
}
