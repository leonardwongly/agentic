"use client";

import { startTransition, useMemo, useState } from "react";
import type { LocalNoteDocument } from "@agentic/integrations";
import type { DashboardData } from "@agentic/repository";

type DashboardProps = {
  initialData: DashboardData;
  initialNotes: LocalNoteDocument[];
};

type RequestState = {
  kind: "idle" | "success" | "error";
  message: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    const message = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : "Request failed.";
    throw new Error(message);
  }

  return payload;
}

export function Dashboard({ initialData, initialNotes }: DashboardProps) {
  const [data, setData] = useState(initialData);
  const [notes, setNotes] = useState(initialNotes);
  const [request, setRequest] = useState("");
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryCategory, setMemoryCategory] = useState("working-style");
  const [noteQuery, setNoteQuery] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [selectedNoteSlug, setSelectedNoteSlug] = useState<string | null>(null);
  const [selectedNoteTitle, setSelectedNoteTitle] = useState("");
  const [selectedNoteContent, setSelectedNoteContent] = useState("");
  const [docsState, setDocsState] = useState<RequestState>({ kind: "idle", message: "" });
  const [submitState, setSubmitState] = useState<RequestState>({ kind: "idle", message: "" });
  const [noteState, setNoteState] = useState<RequestState>({ kind: "idle", message: "" });
  const [isPending, setIsPending] = useState(false);

  const pendingApprovals = useMemo(
    () => data.approvals.filter((approval) => approval.decision === "pending"),
    [data.approvals]
  );

  const selectedNotePreview = useMemo(
    () => notes.find((note) => note.slug === selectedNoteSlug) ?? null,
    [notes, selectedNoteSlug]
  );

  const refreshDashboard = async (producer: Promise<Response>, successMessage: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<{ dashboard: DashboardData }>(await producer);
      startTransition(() => {
        setData(payload.dashboard);
        setSubmitState({ kind: "success", message: successMessage });
      });
    } catch (error) {
      setSubmitState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unexpected request failure."
      });
    } finally {
      setIsPending(false);
    }
  };

  const createGoal = async () => {
    const nextRequest = request.trim();

    if (!nextRequest) {
      setSubmitState({ kind: "error", message: "Enter a request before submitting." });
      return;
    }

    await refreshDashboard(
      fetch("/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ request: nextRequest })
      }),
      "Created a new goal bundle."
    );
    setRequest("");
  };

  const respondApproval = async (approvalId: string, decision: "approved" | "rejected") => {
    await refreshDashboard(
      fetch(`/api/approvals/${approvalId}/respond`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ decision })
      }),
      `Marked the approval as ${decision}.`
    );
  };

  const saveMemory = async () => {
    const content = memoryContent.trim();

    if (!content) {
      setSubmitState({ kind: "error", message: "Memory content cannot be empty." });
      return;
    }

    await refreshDashboard(
      fetch("/api/memory", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          category: memoryCategory,
          content
        })
      }),
      "Saved the memory record."
    );
    setMemoryContent("");
  };

  const cycleIntegration = async (integrationId: string, currentStatus: string) => {
    const statusOrder = ["ready", "manual", "mock", "disabled"] as const;
    const currentIndex = Math.max(statusOrder.indexOf(currentStatus as (typeof statusOrder)[number]), 0);
    const nextStatus = statusOrder[(currentIndex + 1) % statusOrder.length];

    await refreshDashboard(
      fetch("/api/integrations", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          id: integrationId,
          status: nextStatus
        })
      }),
      `Updated integration ${integrationId} to ${nextStatus}.`
    );
  };

  const renderDocs = async () => {
    setIsPending(true);
    setDocsState({ kind: "idle", message: "" });

    try {
      const payload = await readJson<{ result: { stdout: string; stderr: string }; dashboard: DashboardData }>(
        await fetch("/api/docs/render", {
          method: "POST"
        })
      );
      startTransition(() => {
        setData(payload.dashboard);
        setDocsState({
          kind: "success",
          message: payload.result.stdout || "Rendered and validated build/agentic.docx."
        });
      });
    } catch (error) {
      setDocsState({
        kind: "error",
        message: error instanceof Error ? error.message : "The document build failed."
      });
    } finally {
      setIsPending(false);
    }
  };

  const createLocalNote = async () => {
    const title = noteTitle.trim();
    const content = noteContent.trim();

    if (!title || !content) {
      setSubmitState({ kind: "error", message: "A local note needs both a title and content." });
      return;
    }

    setIsPending(true);

    try {
      const payload = await readJson<{ note: LocalNoteDocument; notes: LocalNoteDocument[]; dashboard: DashboardData }>(
        await fetch("/api/integrations/local-notes", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            title,
            content
          })
        })
      );
      startTransition(() => {
        setNotes(payload.notes);
        setData(payload.dashboard);
        setSubmitState({ kind: "success", message: "Created a new local note." });
        setSelectedNoteSlug(payload.note.slug);
        setSelectedNoteTitle(payload.note.title);
        setSelectedNoteContent(payload.note.content.replace(/^#\s+.*\n\n?/u, "").trim());
        setNoteState({ kind: "success", message: "Opened the new note in the editor." });
      });
      setNoteTitle("");
      setNoteContent("");
    } catch (error) {
      setSubmitState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to create the local note."
      });
    } finally {
      setIsPending(false);
    }
  };

  const searchNotes = async () => {
    setIsPending(true);

    try {
      const query = noteQuery.trim();
      const params = query ? `?q=${encodeURIComponent(query)}` : "";
      const payload = await readJson<{ notes: LocalNoteDocument[] }>(await fetch(`/api/integrations/local-notes${params}`));

      startTransition(() => {
        setNotes(payload.notes);

        if (selectedNoteSlug && !payload.notes.some((note) => note.slug === selectedNoteSlug)) {
          setSelectedNoteSlug(null);
          setSelectedNoteTitle("");
          setSelectedNoteContent("");
        }

        setNoteState({
          kind: "success",
          message: query ? `Loaded ${payload.notes.length} matching note${payload.notes.length === 1 ? "" : "s"}.` : "Loaded all local notes."
        });
      });
    } catch (error) {
      setNoteState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to search local notes."
      });
    } finally {
      setIsPending(false);
    }
  };

  const openLocalNote = async (slug: string) => {
    setIsPending(true);

    try {
      const payload = await readJson<{ note: LocalNoteDocument }>(await fetch(`/api/integrations/local-notes/${encodeURIComponent(slug)}`));

      startTransition(() => {
        setSelectedNoteSlug(payload.note.slug);
        setSelectedNoteTitle(payload.note.title);
        setSelectedNoteContent(payload.note.content.replace(/^#\s+.*\n\n?/u, "").trim());
        setNoteState({ kind: "success", message: `Loaded note "${payload.note.title}".` });
      });
    } catch (error) {
      setNoteState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load the selected note."
      });
    } finally {
      setIsPending(false);
    }
  };

  const saveSelectedNote = async () => {
    const slug = selectedNoteSlug;
    const title = selectedNoteTitle.trim();
    const content = selectedNoteContent.trim();

    if (!slug) {
      setNoteState({ kind: "error", message: "Choose a note before saving changes." });
      return;
    }

    if (!title || !content) {
      setNoteState({ kind: "error", message: "A saved note needs both a title and content." });
      return;
    }

    setIsPending(true);

    try {
      const payload = await readJson<{ note: LocalNoteDocument; notes: LocalNoteDocument[]; dashboard: DashboardData }>(
        await fetch(`/api/integrations/local-notes/${encodeURIComponent(slug)}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            title,
            content
          })
        })
      );

      startTransition(() => {
        setNotes(payload.notes);
        setData(payload.dashboard);
        setSelectedNoteSlug(payload.note.slug);
        setSelectedNoteTitle(payload.note.title);
        setSelectedNoteContent(payload.note.content.replace(/^#\s+.*\n\n?/u, "").trim());
        setNoteState({ kind: "success", message: `Saved note "${payload.note.title}".` });
      });
    } catch (error) {
      setNoteState({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to save the selected note."
      });
    } finally {
      setIsPending(false);
    }
  };

  const logout = async () => {
    setIsPending(true);

    try {
      await fetch("/api/session", {
        method: "DELETE"
      });
      window.location.reload();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <main className="dashboard-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Agentic control plane</p>
          <h1>Policy-aware orchestration with a reproducible spec document.</h1>
          <p className="lede">
            The dashboard exposes the Phase 1 foundation: request intake, approval handling, activity history, memory
            review, provider-neutral integrations, and deterministic `agentic.docx` rendering.
          </p>
        </div>
        <div className="hero-actions">
          <div className="hero-button-row">
            <button type="button" className="primary-button" onClick={renderDocs} disabled={isPending}>
              Rebuild `agentic.docx`
            </button>
            <button type="button" className="secondary-button" onClick={logout} disabled={isPending}>
              Lock session
            </button>
          </div>
          <p className={`status-chip ${docsState.kind}`}>{docsState.message || "Ready to build the canonical document."}</p>
        </div>
      </section>

      <section className="grid">
        <article className="card request-card">
          <div className="card-header">
            <h2>Chat intake</h2>
            <span>{data.goals.length} goals</span>
          </div>
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="Example: Triage my inbox and draft replies for anything urgent."
            rows={6}
          />
          <button type="button" className="primary-button" onClick={createGoal} disabled={isPending}>
            Create goal
          </button>
          <p className={`status-chip ${submitState.kind}`}>{submitState.message || "Requests are schema-validated and policy checked before execution."}</p>
          <div className="list-stack">
            {data.goals.slice(0, 4).map((bundle) => (
              <div className="list-item" key={bundle.goal.id}>
                <div>
                  <strong>{bundle.goal.title}</strong>
                  <p>{bundle.goal.explanation}</p>
                </div>
                <span className="pill">{bundle.goal.status}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <h2>Approvals inbox</h2>
            <span>{pendingApprovals.length} pending</span>
          </div>
          <div className="list-stack">
            {pendingApprovals.length === 0 ? <p className="empty-state">No pending approvals.</p> : null}
            {pendingApprovals.map((approval) => (
              <div className="list-item vertical" key={approval.id}>
                <div>
                  <strong>{approval.title}</strong>
                  <p>{approval.rationale}</p>
                </div>
                <div className="approval-actions">
                  <span className="pill">{approval.riskClass}</span>
                  <button type="button" onClick={() => respondApproval(approval.id, "approved")} disabled={isPending}>
                    Approve
                  </button>
                  <button type="button" className="secondary-button" onClick={() => respondApproval(approval.id, "rejected")} disabled={isPending}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <h2>Artifacts</h2>
            <span>{data.latestArtifacts.length} recent</span>
          </div>
          <div className="artifact-stack">
            {data.latestArtifacts.map((artifact) => (
              <div className="artifact-card" key={artifact.id}>
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
            <h2>Activity timeline</h2>
            <span>{data.actionLogs.length} events</span>
          </div>
          <div className="timeline">
            {data.actionLogs.map((log) => (
              <div className="timeline-row" key={log.id}>
                <div className="timeline-dot" />
                <div>
                  <strong>{log.kind}</strong>
                  <p>{log.message}</p>
                  <small>{new Date(log.createdAt).toLocaleString()}</small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <h2>Memory inspector</h2>
            <span>{data.memories.length} records</span>
          </div>
          <label className="field">
            <span>Category</span>
            <select value={memoryCategory} onChange={(event) => setMemoryCategory(event.target.value)}>
              <option value="working-style">working-style</option>
              <option value="preferences">preferences</option>
              <option value="projects">projects</option>
              <option value="travel">travel</option>
            </select>
          </label>
          <textarea
            value={memoryContent}
            onChange={(event) => setMemoryContent(event.target.value)}
            placeholder="Add an observed or confirmed memory."
            rows={4}
          />
          <button type="button" onClick={saveMemory} disabled={isPending}>
            Save memory
          </button>
          <div className="list-stack">
            {data.memories.slice(0, 5).map((memory) => (
              <div className="list-item vertical" key={memory.id}>
                <div>
                  <strong>{memory.category}</strong>
                  <p>{memory.content}</p>
                </div>
                <span className="pill">
                  {memory.memoryType} · {Math.round(memory.confidence * 100)}%
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <h2>Integrations</h2>
            <span>{data.integrations.length} adapters</span>
          </div>
          <div className="list-stack">
            {data.integrations.map((integration) => (
              <div className="list-item vertical" key={integration.id}>
                <div>
                  <strong>{integration.name}</strong>
                  <p>
                    {integration.system} · {integration.capabilities.join(", ")}
                  </p>
                </div>
                <button type="button" className="secondary-button" onClick={() => cycleIntegration(integration.id, integration.status)} disabled={isPending}>
                  {integration.status}
                </button>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <h2>Local notes</h2>
            <span>{notes.length} indexed</span>
          </div>
          <div className="note-toolbar">
            <input
              value={noteQuery}
              onChange={(event) => setNoteQuery(event.target.value)}
              placeholder="Search local notes"
            />
            <button type="button" className="secondary-button" onClick={searchNotes} disabled={isPending}>
              Search
            </button>
          </div>
          <label className="field">
            <span>Title</span>
            <input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Example: Travel packing list" />
          </label>
          <textarea
            value={noteContent}
            onChange={(event) => setNoteContent(event.target.value)}
            placeholder="Write a note that should be searchable through the notes adapter."
            rows={4}
          />
          <button type="button" onClick={createLocalNote} disabled={isPending}>
            Create local note
          </button>
          <p className={`status-chip ${noteState.kind}`}>
            {noteState.message || "Search, open, and edit filesystem-backed notes through the provider-neutral adapter."}
          </p>
          <div className="list-stack">
            {notes.slice(0, 5).map((note) => (
              <div className="list-item vertical" key={note.id}>
                <div>
                  <strong>{note.title}</strong>
                  <p>{note.content.split("\n").slice(1).join(" ").trim().slice(0, 180) || "No note body."}</p>
                </div>
                <div className="note-meta-row">
                  <span className="pill">{new Date(note.updatedAt).toLocaleDateString()}</span>
                  <button type="button" className="secondary-button" onClick={() => openLocalNote(note.slug)} disabled={isPending}>
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="note-editor">
            <div className="card-header">
              <h3>{selectedNotePreview ? `Edit ${selectedNotePreview.title}` : "Note editor"}</h3>
              <span>{selectedNotePreview ? selectedNotePreview.slug : "Select a note"}</span>
            </div>
            <label className="field">
              <span>Editor title</span>
              <input
                value={selectedNoteTitle}
                onChange={(event) => setSelectedNoteTitle(event.target.value)}
                placeholder="Open a note to edit its title"
                disabled={!selectedNoteSlug}
              />
            </label>
            <textarea
              value={selectedNoteContent}
              onChange={(event) => setSelectedNoteContent(event.target.value)}
              placeholder="Open a note to edit its body."
              rows={6}
              disabled={!selectedNoteSlug}
            />
            <button type="button" onClick={saveSelectedNote} disabled={isPending || !selectedNoteSlug}>
              Save selected note
            </button>
          </div>
        </article>

        <article className="card">
          <div className="card-header">
            <h2>Watchers</h2>
            <span>{data.watchers.length} active models</span>
          </div>
          <div className="list-stack">
            {data.watchers.length === 0 ? <p className="empty-state">No active watchers.</p> : null}
            {data.watchers.map((watcher) => (
              <div className="list-item vertical" key={watcher.id}>
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
