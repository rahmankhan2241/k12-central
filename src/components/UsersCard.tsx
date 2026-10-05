import { useState } from "react";
import { useAuth } from "../useAuth";
import {
  ADMIN_USERNAME,
  DEFAULT_MODULE_IDS,
  MODULES,
  formatModules,
} from "../users";
import type { AppUser, ModuleId } from "../users";
import { AlertIcon, CheckCircleIcon, LockIcon, PencilIcon, PlusIcon, TrashIcon, UserIcon } from "../icons";

/** Settings → Access & Security: create accounts and choose their modules. */

function initials(name: string): string {
  const cleaned = name.replace(/[^a-z0-9]/gi, "");
  return (cleaned.slice(0, 2) || "U").toUpperCase();
}

function ModulePicker({
  selected,
  onToggle,
  onSet,
}: {
  selected: ModuleId[];
  onToggle: (id: ModuleId) => void;
  onSet: (ids: ModuleId[]) => void;
}) {
  return (
    <>
      <div className="module-picker">
        {MODULES.map((m) => {
          const on = selected.includes(m.id);
          return (
            <label key={m.id} className={`module-option ${on ? "on" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => onToggle(m.id)} />
              {m.label}
              {m.soon ? " (soon)" : ""}
            </label>
          );
        })}
      </div>
      <div className="module-picker-actions">
        <button className="link-btn" type="button" onClick={() => onSet(MODULES.map((m) => m.id))}>
          All access
        </button>
        <button className="link-btn" type="button" onClick={() => onSet([...DEFAULT_MODULE_IDS])}>
          Default (Historic Report only)
        </button>
      </div>
    </>
  );
}

export default function UsersCard() {
  const { users, usersStatus, addUser, updateUser, removeUser, retrySync } = useAuth();

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newModules, setNewModules] = useState<ModuleId[]>([...DEFAULT_MODULE_IDS]);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [editModules, setEditModules] = useState<ModuleId[]>([]);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const statusLabel =
    usersStatus === "saving"
      ? " · saving…"
      : usersStatus === "saved"
        ? " · saved"
        : usersStatus === "failed"
          ? " · save failed"
          : "";

  const toggleModule = (list: ModuleId[], id: ModuleId): ModuleId[] =>
    list.includes(id) ? list.filter((m) => m !== id) : [...list, id];

  const createUser = () => {
    setError(null);
    setSuccess(null);
    const result = addUser(newUsername, newPassword, newModules);
    if (!result.ok) {
      setError(result.error ?? "Could not create the user.");
      return;
    }
    setSuccess(`User "${newUsername.trim()}" created. They can now sign in with the modules listed.`);
    setNewUsername("");
    setNewPassword("");
    setNewModules([...DEFAULT_MODULE_IDS]);
    setShowNewPassword(false);
  };

  const startEdit = (user: AppUser) => {
    setError(null);
    setSuccess(null);
    setConfirmDelete(null);
    setEditing(user.username);
    setEditPassword("");
    setEditModules([...user.modules]);
  };

  const saveEdit = () => {
    if (!editing) return;
    setError(null);
    setSuccess(null);
    const trimmed = editPassword.trim();
    const result = updateUser(editing, {
      password: trimmed.length > 0 ? trimmed : undefined,
      modules: editModules,
    });
    if (!result.ok) {
      setError(result.error ?? "Could not update the user.");
      return;
    }
    setSuccess(`User "${editing}" updated.`);
    setEditing(null);
  };

  const deleteUser = (username: string) => {
    setError(null);
    setSuccess(null);
    removeUser(username);
    setConfirmDelete(null);
    if (editing && editing === username) setEditing(null);
    setSuccess(`User "${username}" deleted.`);
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <UserIcon size={16} />
          Users &amp; Access
        </div>
        <span className="row-count">
          {users.length + 1} account{users.length + 1 === 1 ? "" : "s"}
          {statusLabel}
        </span>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p className="drawer-hint">
          Create an account for each person and tick the modules they may open. New accounts start
          with <b>Historic Report only</b>. Home is available to everyone, Settings stays admin-only,
          and the admin account always has full access.
        </p>

        <div className="users-list">
          <div className="user-row">
            <div className="user-avatar">{initials(ADMIN_USERNAME)}</div>
            <div className="user-main">
              <div className="user-name-row">
                <span className="user-name">{ADMIN_USERNAME}</span>
                <span className="badge green">Admin</span>
              </div>
              <div className="user-modules">
                <span className="module-chip">Full access · manages users and Settings</span>
              </div>
            </div>
          </div>

          {users.map((user) => (
            <div className="user-row" key={user.username}>
              <div className="user-avatar">{initials(user.username)}</div>
              <div className="user-main">
                <div className="user-name-row">
                  <span className="user-name">{user.username}</span>
                </div>
                <div className="user-modules">
                  {user.modules.length === 0 ? (
                    <span className="module-chip">No modules</span>
                  ) : (
                    user.modules.map((id) => (
                      <span className="module-chip" key={id}>
                        {formatModules([id])}
                      </span>
                    ))
                  )}
                </div>
              </div>
              {confirmDelete === user.username ? (
                <div className="user-confirm">
                  <span>Delete?</span>
                  <button className="link-btn danger" onClick={() => deleteUser(user.username)}>
                    Yes, delete
                  </button>
                  <button className="link-btn" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="user-actions">
                  <button className="icon-btn" onClick={() => startEdit(user)} title="Edit user">
                    <PencilIcon size={13} />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => {
                      setConfirmDelete(user.username);
                      setSuccess(null);
                      setError(null);
                    }}
                    title="Delete user"
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {editing ? (
          <div className="user-form">
            <div className="user-form-title">Edit &quot;{editing}&quot;</div>
            <div className="user-form-grid">
              <input
                type="text"
                placeholder="New password (leave blank to keep current)"
                value={editPassword}
                autoComplete="new-password"
                onChange={(e) => {
                  setEditPassword(e.target.value);
                  if (error) setError(null);
                }}
              />
            </div>
            <ModulePicker
              selected={editModules}
              onToggle={(id) => setEditModules((list) => toggleModule(list, id))}
              onSet={setEditModules}
            />
            <div className="user-form-actions">
              <button className="btn primary" onClick={saveEdit}>
                Save changes
              </button>
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="user-form">
            <div className="user-form-title">Add user</div>
            <div className="user-form-grid">
              <input
                type="text"
                placeholder="Username (min 3 characters)"
                value={newUsername}
                autoComplete="off"
                onChange={(e) => {
                  setNewUsername(e.target.value);
                  if (error) setError(null);
                }}
              />
              <div className="user-password-row">
                <input
                  type={showNewPassword ? "text" : "password"}
                  placeholder="Password (min 6 characters)"
                  value={newPassword}
                  autoComplete="new-password"
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (error) setError(null);
                  }}
                />
                <button className="btn" type="button" onClick={() => setShowNewPassword((s) => !s)}>
                  {showNewPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <ModulePicker
              selected={newModules}
              onToggle={(id) => setNewModules((list) => toggleModule(list, id))}
              onSet={setNewModules}
            />
            <div className="user-form-actions">
              <button className="btn primary" onClick={createUser}>
                <PlusIcon size={14} />
                Create user
              </button>
            </div>
          </div>
        )}

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
        {usersStatus === "failed" && (
          <div className="upload-error">
            <AlertIcon size={14} />
            The account list could not be saved to the database — changes work on this device only
            until the save succeeds.
            <button className="link-btn" onClick={retrySync}>
              Retry now
            </button>
          </div>
        )}

        <div className="historic-footnote">
          <LockIcon size={13} />
          Soft gate: accounts are checked in the browser — keep the Supabase key private if the data
          itself must stay secret.
        </div>
      </div>
    </div>
  );
}
