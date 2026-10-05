import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useAppAuth } from "../useAppAuth";
import { AlertIcon, K12Logo, LockIcon } from "../icons";

/** Extra wait after repeated wrong attempts, in seconds. */
const COOLDOWN_SECONDS = 5;
const ATTEMPTS_BEFORE_COOLDOWN = 3;

/**
 * Blocks the console until the shared access password is entered.
 * Renders its children only when signed in.
 */
export default function LoginGate({ children }: { children: ReactNode }) {
  const { ready, authed, submitPassword } = useAppAuth();
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ready && !authed) inputRef.current?.focus();
  }, [ready, authed]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!ready) {
    return (
      <div className="login-screen">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  }

  if (authed) return <>{children}</>;

  const locked = busy || cooldown > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked) return;
    const entered = value;
    if (!entered) {
      setError("Enter the access password.");
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await submitPassword(entered);
    setBusy(false);
    if (ok) {
      setValue("");
      setAttempts(0);
      return;
    }
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setValue("");
    inputRef.current?.focus();
    if (nextAttempts % ATTEMPTS_BEFORE_COOLDOWN === 0) {
      setCooldown(COOLDOWN_SECONDS);
      setError(`Wrong password. Too many attempts — wait ${COOLDOWN_SECONDS}s and try again.`);
    } else {
      setError("Wrong password. Check it and try again.");
    }
  };

  return (
    <div className="login-screen">
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
          Restricted access
        </div>
        <h1 className="login-title">Enter the access password</h1>
        <p className="login-sub">
          This console is private. Only people with the shared password can open it — ask the admin if
          you don&apos;t have it.
        </p>

        <label className="login-label" htmlFor="k12-login-password">
          Password
        </label>
        <div className="login-input-row">
          <input
            id="k12-login-password"
            ref={inputRef}
            className="login-input"
            type={show ? "text" : "password"}
            value={value}
            autoComplete="current-password"
            placeholder="Access password"
            disabled={locked}
            onChange={(e) => {
              setValue(e.target.value);
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

        <button className="btn primary login-submit" type="submit" disabled={locked || !value}>
          {busy ? "Checking…" : cooldown > 0 ? `Wait ${cooldown}s` : "Open console"}
        </button>

        <div className="login-foot">
          The password can be changed in Settings → Access &amp; Security after signing in.
        </div>
      </form>
    </div>
  );
}
