"use client";

import { useState, type FormEvent } from "react";

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
    const trimmedAccessKey = accessKey.trim();

    if (!trimmedAccessKey) {
      setState({ kind: "error", message: "Enter the Agentic access key before unlocking." });
      return;
    }

    setIsPending(true);
    setState({ kind: "idle", message: "" });

    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ accessKey: trimmedAccessKey })
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
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void unlock();
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
            <p className="status-chip">Local development fallback is enabled. Set `AGENTIC_ACCESS_KEY` to replace it.</p>
          ) : null}
        </div>
        <form className="auth-form" onSubmit={onSubmit}>
          <label className="field">
            <span>Access key</span>
            <input
              type="password"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              placeholder="Enter the Agentic access key"
              autoComplete="one-time-code"
            />
          </label>
          <button type="submit" className="primary-button" disabled={isPending || authMode.requiresConfiguredKey}>
            Unlock
          </button>
          <p className={`status-chip ${state.kind}`}>{state.message || "A valid session cookie is required before the UI can load."}</p>
          {authMode.usesDevelopmentFallback ? (
            <p className="operator-product-subtitle">
              Local-only fallback key: <code>agentic-local-dev-key</code>
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
