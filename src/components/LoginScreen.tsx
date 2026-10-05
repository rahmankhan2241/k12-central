import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../useAuth";
import { AlertIcon, K12Logo, LockIcon } from "../icons";

/** Extra wait after repeated wrong attempts, in seconds. */
const COOLDOWN_SECONDS = 5;
const ATTEMPTS_BEFORE_COOLDOWN = 3;

/**
 * Full-screen sign-in. The console only opens after a successful login; each
 * account then sees only its assigned modules. Sessions survive refreshes
 * until Sign out.
 */
export default function LoginScreen() {
  const { login, users, usersStatus, reloadUsers } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadingAccounts = usersStatus === "loading";
  const accountsUnavailable = usersStatus === "failed" && users.length === 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const locked = cooldown > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (locked || loadingAccounts) return;
    const result = login(username, password);
    if (result.ok) return;
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setPassword("");
    inputRef.current?.focus();
    if (nextAttempts % ATTEMPTS_BEFORE_COOLDOWN === 0) {
      setCooldown(COOLDOWN_SECONDS);
      setError(`Wrong username or password. Too many attempts — wait ${COOLDOWN_SECONDS}s and try again.`);
    } else {
      setError(result.error ?? "Wrong username or password.");
    }
  };

  return (
    <div className="app-login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <K12Logo size={46} />
          <div>
            <div className="login-brand-title">K12 Techno Services</div>
            <div className="login-brand-sub">Central System</div>
          </div>
        </div>

        <div className="login-badge">
          <LockIcon size={14} />
          Sign in
        </div>
        <h1 className="login-title">Welcome back</h1>
        <p className="login-sub">
          Sign in with the account the admin created for you. Each account opens only the modules
          assigned to it.
        </p>

        <label className="login-label" htmlFor="k12-username">
          Username
        </label>
        <input
          id="k12-username"
          ref={inputRef}
          className="login-input"
          type="text"
          value={username}
          autoComplete="username"
          placeholder="Your username"
          disabled={locked}
          onChange={(e) => {
            setUsername(e.target.value);
            if (error) setError(null);
          }}
        />

        <label className="login-label" htmlFor="k12-password">
          Password
        </label>
        <div className="login-input-row">
          <input
            id="k12-password"
            className="login-input"
            type={show ? "text" : "password"}
            value={password}
            autoComplete="current-password"
            placeholder="Your password"
            disabled={locked}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => setShow((s) => !s)}
            tabIndex={-1}
            title={show ? "Hide password" : "Show password"}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>

        {error && (
          <div className="upload-error">
            <AlertIcon size={14} />
            {error}
          </div>
        )}

        {accountsUnavailable && (
          <div className="upload-error">
            <AlertIcon size={14} />
            The account list couldn&apos;t be loaded — only the admin can sign in right now.
            <button className="link-btn" type="button" onClick={reloadUsers}>
              Retry
            </button>
          </div>
        )}

        <button
          className="btn primary login-submit"
          type="submit"
          disabled={locked || loadingAccounts || !username.trim() || !password}
        >
          {cooldown > 0 ? `Wait ${cooldown}s` : loadingAccounts ? "Loading accounts…" : "Sign in"}
        </button>

        <div className="login-foot">
          Access is managed by the admin in Settings → Access &amp; Security. You stay signed in until
          you use Sign out.
        </div>
      </form>
    </div>
  );
}
