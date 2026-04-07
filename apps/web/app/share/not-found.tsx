export default function ShareNotFound() {
  return (
    <main className="dashboard-shell public-share-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Shared from Agentic</p>
          <h1>That share link is invalid or expired.</h1>
          <p className="lede">
            Ask the sender for a fresh link. Public goal shares are signed and time-limited so the locked control plane stays private.
          </p>
        </div>
        <div className="hero-actions">
          <p className="status-chip error">Share unavailable</p>
        </div>
      </section>
    </main>
  );
}
