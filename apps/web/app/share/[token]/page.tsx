import { notFound } from "next/navigation";
import {
  buildSharedGoalView,
  createGoalShareExpiredLog,
  createGoalShareFailedAccessLog,
  fingerprintGoalShareToken,
  inspectGoalShareToken
} from "../../../lib/share";
import { PublicShareViewTracker } from "../../../components/public-share-view-tracker";
import { getSeededRepository } from "../../../lib/server";

export const dynamic = "force-dynamic";

type SharePageProps = {
  params: Promise<{
    token: string;
  }>;
};

async function auditBlockedShareAccess(params: {
  repository: Awaited<ReturnType<typeof getSeededRepository>>;
  goalId: string;
  shareId: string;
  tokenFingerprint: string;
  reason: "expired" | "revoked" | "not_found";
}) {
  const bundle = await params.repository.getGoalBundle(params.goalId);

  if (!bundle) {
    return;
  }

  const now = Date.now();
  const logs = [
    ...(params.reason === "expired"
      ? [createGoalShareExpiredLog(bundle, params.shareId, params.tokenFingerprint, now)]
      : []),
    createGoalShareFailedAccessLog(bundle, params.shareId, params.tokenFingerprint, params.reason, now)
  ].filter((log) => log !== null);

  if (logs.length > 0) {
    await params.repository.appendGoalActionLogs(bundle.goal.id, logs);
  }
}

export default async function ShareGoalPage({ params }: SharePageProps) {
  const { token } = await params;
  const tokenInspection = inspectGoalShareToken(token);

  if (!tokenInspection.valid) {
    notFound();
  }

  const repository = await getSeededRepository();
  const tokenFingerprint = fingerprintGoalShareToken(token);
  const share = await repository.getGoalShareByTokenFingerprint(tokenFingerprint);

  if (!share || share.id !== tokenInspection.payload.shareId || share.goalId !== tokenInspection.payload.goalId) {
    if (tokenInspection.valid) {
      await auditBlockedShareAccess({
        repository,
        goalId: tokenInspection.payload.goalId,
        shareId: tokenInspection.payload.shareId,
        tokenFingerprint,
        reason: "not_found"
      });
    }

    notFound();
  }

  if (share.status !== "active") {
    await auditBlockedShareAccess({
      repository,
      goalId: share.goalId,
      shareId: share.id,
      tokenFingerprint,
      reason: "revoked"
    });

    notFound();
  }

  if (tokenInspection.expired || Date.parse(share.expiresAt) <= Date.now()) {
    await auditBlockedShareAccess({
      repository,
      goalId: share.goalId,
      shareId: share.id,
      tokenFingerprint,
      reason: "expired"
    });

    notFound();
  }

  const bundle = await repository.getGoalBundle(tokenInspection.payload.goalId);

  if (!bundle) {
    notFound();
  }

  const sharedGoal = buildSharedGoalView(bundle);

  return (
    <main className="dashboard-shell public-share-shell">
      <PublicShareViewTracker token={token} />
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Shared from Agentic</p>
          <h1>{sharedGoal.title}</h1>
          <p className="lede">{sharedGoal.explanation}</p>
          <p className="public-share-disclosure">
            This read-only page shows a reviewed public projection. Internal requests, approvals, watcher details,
            action logs, memory context, workflow checkpoints, artifact bodies, and internal artifact metadata stay
            hidden. Basic artifact listing details, such as titles, types, and timestamps included in the public
            projection, may still be shown.
          </p>
        </div>
        <div className="hero-actions">
          <p className="status-chip">Read-only shared goal</p>
          <div className="public-share-meta">
            <div className="list-item vertical">
              <strong>Status</strong>
              <p>{sharedGoal.status}</p>
            </div>
            <div className="list-item vertical">
              <strong>Intent</strong>
              <p>{sharedGoal.intent}</p>
            </div>
            <div className="list-item vertical">
              <strong>Updated</strong>
              <p>{new Date(sharedGoal.updatedAt).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid">
        <article className="card">
          <div className="card-header">
            <h2>Tasks</h2>
            <span>{sharedGoal.taskCount}</span>
          </div>
          <div className="list-stack">
            {sharedGoal.tasks.map((task, index) => (
              <div className="list-item vertical" key={`${task.title}-${task.state}-${index}`}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.summary}</p>
                </div>
                <div className="share-tag-row">
                  <span className="pill">{task.state}</span>
                  <span className="pill">{task.riskClass}</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <h2>Artifacts</h2>
            <span>{sharedGoal.artifactCount}</span>
          </div>
          <div className="artifact-stack">
            {sharedGoal.artifacts.length === 0 ? <p className="empty-state">No artifacts are available for this goal yet.</p> : null}
            {sharedGoal.artifacts.map((artifact, index) => (
              <div className="artifact-card" key={`${artifact.title}-${artifact.artifactType}-${index}`}>
                <div className="card-header">
                  <strong>{artifact.title}</strong>
                  <span className="pill">{artifact.artifactType}</span>
                </div>
                <pre>{artifact.preview}</pre>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <h2>Watchers</h2>
            <span>{sharedGoal.watcherCount}</span>
          </div>
          <div className="list-stack">
            {sharedGoal.watcherCount === 0 ? <p className="empty-state">No active watchers for this goal.</p> : null}
            {sharedGoal.watcherCount > 0 ? (
              <div className="list-item vertical">
                <strong>Active watchers</strong>
                <p>{sharedGoal.watcherCount} watcher(s) are attached to this goal. Public share links do not expose watcher details.</p>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </main>
  );
}
