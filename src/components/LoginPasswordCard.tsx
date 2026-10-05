import { useState } from "react";
import { useAppAuth } from "../useAppAuth";
import { AlertIcon, CheckCircleIcon, LockIcon } from "../icons";

/**
 * Settings → Access & Security.
 * Shows the Settings password (hidden by default) and lets you change it. The
 * same password is asked every time someone opens Settings.
 */
export default function LoginPasswordCard() {
  const { password, changePassword, saveStatus, retrySave } = useAppAuth();
  const [reveal, setReveal] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const statusLabel =
    saveStatus === "saving"
      ? " · saving…"
      : saveStatus === "saved"
        ? " · saved"
        : saveStatus === "failed"
          ? " · save failed"
          : "";

  const submit = async () => {
    setError(null);
    setSuccess(null);
    if (!newPassword.trim()) {
      setError("Enter the new password.");
      return;
    }
    if (newPassword.trim() !== confirm.trim()) {
      setError("The two passwords do not match.");
      return;
    }
    const result = await changePassword(newPassword);
    if (!result.ok) {
      setError(result.error ?? "Could not update the password.");
      return;
    }
    setNewPassword("");
    setConfirm("");
    setSuccess("Password updated. Share the new one with whoever you authorize.");
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <LockIcon size={16} />
          Login Password
        </div>
        <span className="row-count">Settings only{statusLabel}</span>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="drawer-hint">
          This password protects Settings and is asked again every time Settings is opened. People you
          authorize use the same password as you — there are no separate accounts. It is stored in the
          K12 Central database, so changing it here applies everywhere without a redeploy. The rest of the
          console stays open to everyone.
        </p>

        <div className="password-current">
          <div>
            <div className="password-current-label">Current password</div>
            <div className="password-current-value">{reveal ? password : "•".repeat(Math.max(password.length, 8))}</div>
          </div>
          <button className="btn" onClick={() => setReveal((r) => !r)}>
            {reveal ? "Hide" : "Show"}
          </button>
        </div>

        <div className="password-change">
          <div className="password-change-title">Change password</div>
          <div className="manual-add password-change-grid">
            <input
              type="text"
              placeholder="New password (min 6 characters)"
              value={newPassword}
              autoComplete="new-password"
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (error) setError(null);
                if (success) setSuccess(null);
              }}
            />
            <input
              type="text"
              placeholder="Confirm new password"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => {
                setConfirm(e.target.value);
                if (error) setError(null);
                if (success) setSuccess(null);
              }}
            />
            <button className="btn primary" onClick={submit}>
              Update password
            </button>
          </div>
        </div>

        {error && (
          <div className="upload-error">
            <AlertIcon size={14} />
            {error}
          </div>
        )}
        {success && (
          <div className="upload-success">
            <CheckCircleIcon size={14} />
            {success}
          </div>
        )}
        {saveStatus === "failed" && (
          <div className="upload-error">
            <AlertIcon size={14} />
            Could not save the new password to the database — it works on this device only until it
            saves.
            <button className="link-btn" onClick={retrySave}>
              Retry now
            </button>
          </div>
        )}

        <div className="historic-footnote">
          <LockIcon size={13} />
          Soft gate: the browser checks the password before loading Settings — keep the Supabase key
          private if the data itself must stay secret.
        </div>
      </div>
    </div>
  );
}
