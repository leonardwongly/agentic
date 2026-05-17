"use client";

import { useState } from "react";

type AuthGateProps = {
  authMode: {
    requiresConfiguredKey: boolean;
    usesDevelopmentFallback: boolean;
  };
};

export function AuthGate({ authMode }: AuthGateProps) {
  const [accessKey, setAccessKey] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "error"; message: string }>({
    kind: "idle",
    message: ""
  });
  const [isPending, setIsPending] = useState(false);

  const unlock = async () => {
    setIsPending(true);
    setState({ kind: "idle", message: "" });

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ accessKey })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to unlock the dashboard.");
      }

      window.location.reload();
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to unlock the dashboard."
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <main className="dashboard-shell auth-shell">
      <section className="hero-panel auth-panel">
        <div>
          <p className="eyebrow">Agentic access</p>
          <h1>Unlock the single-user control plane.</h1>
          <p className="lede">
            The dashboard and API now require an access key before any goals, memories, approvals, or document builds are exposed.
          </p>
          {authMode.requiresConfiguredKey ? (
            <p className="status-chip error">Set `AGENTIC_ACCESS_KEY` in the environment before using the app.</p>
          ) : null}
          {authMode.usesDevelopmentFallback ? (
            <p className="status-chip">
              Explicit local development fallback is enabled. Set `AGENTIC_ACCESS_KEY` to replace it.
            </p>
          ) : null}
        </div>
        <div className="auth-form">
          <label className="field">
            <span>Access key</span>
            <input
              type="password"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              placeholder="Enter the Agentic access key"
              autoComplete="current-password"
            />
          </label>
          <button type="button" className="primary-button" onClick={unlock} disabled={isPending || authMode.requiresConfiguredKey}>
            Unlock
          </button>
          <p className={`status-chip ${state.kind}`}>{state.message || "A valid session cookie is required before the UI can load."}</p>
        </div>
      </section>
    </main>
  );
}
