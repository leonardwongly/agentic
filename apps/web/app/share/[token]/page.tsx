import { notFound } from "next/navigation";
import { buildSharedGoalView, createGoalShareViewedLog, verifyGoalShareToken } from "../../../lib/share";
import { getSeededRepository } from "../../../lib/server";

export const dynamic = "force-dynamic";

type SharePageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function ShareGoalPage({ params }: SharePageProps) {
  const { token } = await params;
  const verifiedToken = verifyGoalShareToken(token);

  if (!verifiedToken) {
    notFound();
  }

  const repository = await getSeededRepository();
  let bundle = await repository.getGoalBundle(verifiedToken.goalId);

  if (!bundle) {
    notFound();
  }

  const shareViewLog = createGoalShareViewedLog(bundle, token);

  if (shareViewLog) {
    bundle = {
      ...bundle,
      actionLogs: [...bundle.actionLogs, shareViewLog]
    };
    await repository.saveGoalBundle(bundle);
  }

  const sharedGoal = buildSharedGoalView(bundle);

  return (
    <main className="dashboard-shell public-share-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Shared from Agentic</p>
          <h1>{sharedGoal.title}</h1>
          <p className="lede">{sharedGoal.explanation}</p>
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
                <pre>{artifact.content}</pre>
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
            {sharedGoal.watchers.length === 0 ? <p className="empty-state">No active watchers for this goal.</p> : null}
            {sharedGoal.watchers.map((watcher, index) => (
              <div className="list-item vertical" key={`${watcher.targetEntity}-${watcher.frequency}-${index}`}>
                <div>
                  <strong>{watcher.targetEntity}</strong>
                  <p>{watcher.condition}</p>
                </div>
                <span className="pill">{watcher.frequency}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
