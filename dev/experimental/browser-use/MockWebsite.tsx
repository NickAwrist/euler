import { ArrowUpRight, Box, Check, LockKeyhole } from "lucide-react";
import { Button } from "../../../ui/components/Button";

type Props = {
  login: boolean;
  interactive: boolean;
  selecting: boolean;
  selected: string | null;
  onSelect: (name: string) => void;
  onLogin: () => void;
};

export function MockWebsite({
  login,
  interactive,
  selecting,
  selected,
  onSelect,
  onLogin,
}: Props) {
  return (
    <div className="mock-site">
      <header className="mock-site-header">
        <span>
          <Box size={22} /> Parcel
        </span>
        <span>Workspace / Queue service</span>
        <span>Demo account</span>
      </header>
      {login ? (
        <div className="mock-login">
          <LockKeyhole size={26} />
          <h2>Sign in to Parcel</h2>
          <p>Continue to your workspace.</p>
          <div className="mock-login-fields">
            <label>
              Email
              <input
                aria-label="Demo email"
                value="sam@example.test"
                readOnly
              />
            </label>
            <label>
              Password
              <input
                aria-label="Demo password"
                value="demo-only"
                type="password"
                readOnly
              />
            </label>
          </div>
          <Button disabled={!interactive} onClick={onLogin}>
            Simulate sign in
          </Button>
          <small>Fictional sign-in screen. No credentials are collected.</small>
        </div>
      ) : (
        <div className="mock-dashboard">
          <div className="mock-site-heading">
            <div>
              <p>Queue service</p>
              <h2>Deployments</h2>
            </div>
            <span className="mock-environment">Production</span>
          </div>
          <p className="mock-site-description">
            Recent releases and their deployment status.
          </p>
          <div className="mock-deployment-table">
            <div className="mock-table-head">
              <span>Deployment</span>
              <span>Status</span>
              <span>Created</span>
            </div>
            {(
              [
                ["Improve worker shutdown", "8f2c91a", "Ready", "12 min ago"],
                ["Tune retry backoff", "6d01b3e", "Ready", "2 hours ago"],
                ["Add queue metrics", "40e2fa8", "Ready", "Yesterday"],
              ] as const
            ).map(([name, hash, status, time]) => (
              <button
                type="button"
                className={`mock-deployment ${selected === name ? "mock-selected" : ""}`}
                key={hash}
                disabled={!interactive || !selecting}
                onClick={() => onSelect(name)}
                aria-label={`Select deployment: ${name}`}
              >
                <span>
                  <strong>{name}</strong>
                  <small>main / {hash}</small>
                </span>
                <span>
                  <Check size={14} /> {status}
                </span>
                <span>
                  {time}
                  <ArrowUpRight size={15} />
                </span>
              </button>
            ))}
          </div>
          <p className="mock-site-footnote">
            All times shown in your local timezone.
          </p>
        </div>
      )}
    </div>
  );
}
