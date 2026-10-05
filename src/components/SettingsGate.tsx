import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useAppAuth } from "../useAppAuth";
import { AlertIcon, K12Logo, LockIcon } from "../icons";

/** Extra wait after repeated wrong attempts, in seconds. */
const COOLDOWN_SECONDS = 5;
const ATTEMPTS_BEFORE_COOLDOWN = 3;

/**
 * Blocks ONLY the Settings page until the shared password is entered.
 *
 * The unlocked state is plain component state, and this component unmounts as
 * soon as the user leaves Settings — so every visit asks for the password
 * again. Nothing about an unlock is stored anywhere.
 */
export default function SettingsGate({ children }: { children: ReactNode }) {
  const { ready, password } = useAppAuth();
  const [unlocked, setUnlocked] = useState(false);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ready && !unlocked) inputRef.current?.focus();
  }, [ready, unlocked]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!ready) {
    return (
      <div className="settings-gate">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  }

  if (unlocked) return <>{children}</>;

  const locked = cooldown > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (locked) return;
    if (!value) {
      setError("Enter the access password.");
      return;
    }
    if (value !== password) {
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
      return;
    }
    setValue("");
    setError(null);
    setUnlocked(true);
  };

  return (
    <div className="settings-gate">
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
          Settings locked
        </div>
        <h1 className="login-title">Enter the access password</h1>
        <p className="login-sub">
          Settings is protected and asks for the password every time it is opened. The rest of the
          console stays open to everyone — use the menu on the left to go back.
        </p>

        <label className="login-label" htmlFor="k12-settings-password">
          Password
        </label>
        <div className="login-input-row">
          <input
            id="k12-settings-password"
            ref={inputRef}
            className="login-input"
            type={show ? "text" : "password"}
            value={value}
            autoComplete="off"
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
          {cooldown > 0 ? `Wait ${cooldown}s` : "Unlock settings"}
        </button>

        <div className="login-foot">
          The password can be changed in Settings → Access &amp; Security after unlocking.
        </div>
      </form>
    </div>
  );
}
