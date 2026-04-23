"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import type { GoalTemplate } from "@agentic/contracts";
import {
  describeIntegrationReadiness,
  type LocalNoteDocument,
} from "@agentic/integrations/client";
import { getMemoryFreshness } from "@agentic/memory";
import type { DashboardData } from "@agentic/repository";
import { AgentsPanel } from "./agents";
import type { RequestState } from "./dashboard-types";
import {
  BulkMemoryActions,
  FeatureHelp,
  MemorySearch,
  MemoryTypeHelp,
  NoMemoriesEmpty,
  NoTemplatesEmpty,
  NoWatchersEmpty,
  RelativeTime,
  StatusBadge,
  toast,
  useBulkMemorySelection,
} from "./ui";

type DashboardAdvancedSurfaceProps = {
  showAdvancedOperations: boolean;
  data: DashboardData;
  notes: LocalNoteDocument[];
  templates: GoalTemplate[];
  templateState: RequestState;
  highlightedItemId: string | null;
  getItemAnchorId: (itemId: string) => string;
  isPending: boolean;
  memoryCategory: string;
  setMemoryCategory: Dispatch<SetStateAction<string>>;
  memoryContent: string;
  setMemoryContent: Dispatch<SetStateAction<string>>;
  saveMemory: () => void;
  updateMemory: (
    memoryId: string,
    action: "review" | "confirm",
  ) => Promise<void>;
  connectGoogleProvider: () => void;
  cycleIntegration: (
    integrationId: string,
    currentStatus: DashboardData["integrations"][number]["status"],
  ) => Promise<void>;
  noteQuery: string;
  setNoteQuery: Dispatch<SetStateAction<string>>;
  searchNotes: () => void;
  noteTitle: string;
  setNoteTitle: Dispatch<SetStateAction<string>>;
  noteContent: string;
  setNoteContent: Dispatch<SetStateAction<string>>;
  createLocalNote: () => void;
  noteState: RequestState;
  openLocalNote: (slug: string) => void;
  selectedNoteSlug: string | null;
  selectedNoteTitle: string;
  setSelectedNoteTitleDraft: (value: string) => void;
  selectedNoteContent: string;
  setSelectedNoteContentDraft: (value: string) => void;
  saveSelectedNote: () => void;
  updateWatcher: (
    watcherId: string,
    action: "pause" | "resume",
  ) => Promise<void>;
  loadTemplates: () => void;
  runTemplate: (templateId: string) => void;
  deleteTemplate: (templateId: string, updatedAt: string) => void;
};

export function DashboardAdvancedSurface({
  showAdvancedOperations,
  data,
  notes,
  templates,
  templateState,
  highlightedItemId,
  getItemAnchorId,
  isPending,
  memoryCategory,
  setMemoryCategory,
  memoryContent,
  setMemoryContent,
  saveMemory,
  updateMemory,
  connectGoogleProvider,
  cycleIntegration,
  noteQuery,
  setNoteQuery,
  searchNotes,
  noteTitle,
  setNoteTitle,
  noteContent,
  setNoteContent,
  createLocalNote,
  noteState,
  openLocalNote,
  selectedNoteSlug,
  selectedNoteTitle,
  setSelectedNoteTitleDraft,
  selectedNoteContent,
  setSelectedNoteContentDraft,
  saveSelectedNote,
  updateWatcher,
  loadTemplates,
  runTemplate,
  deleteTemplate,
}: DashboardAdvancedSurfaceProps) {
  const memoryBulkSelection = useBulkMemorySelection();
  const integrationSurfaces = useMemo(
    () =>
      data.integrations.map((integration) => ({
        integration,
        readiness: describeIntegrationReadiness(integration),
      })),
    [data.integrations],
  );
  const selectedNotePreview = useMemo(
    () => notes.find((note) => note.slug === selectedNoteSlug) ?? null,
    [notes, selectedNoteSlug],
  );

  return (
    <>
      <article
        className={`card ${showAdvancedOperations ? "advanced-operations-expanded" : "advanced-surface-hidden"}`}
        id="section-memory"
      >
        <div className="card-header">
          <h2>Memory inspector</h2>
          <span>{data.memories.length} records</span>
        </div>
        <MemorySearch
          memories={data.memories.map((memory) => ({
            id: memory.id,
            content: memory.content,
            category: memory.category,
            memoryType: memory.memoryType,
            confidence: memory.confidence,
            createdAt: memory.createdAt,
          }))}
          categories={[
            ...new Set(data.memories.map((memory) => memory.category)),
          ]}
          memoryTypes={[
            ...new Set(data.memories.map((memory) => memory.memoryType)),
          ]}
          onSelect={() => {}}
        />
        {memoryBulkSelection.selectedIds.size > 0 ? (
          <BulkMemoryActions
            selectedMemories={data.memories
              .filter((memory) =>
                memoryBulkSelection.selectedIds.has(memory.id),
              )
              .map((memory) => ({
                id: memory.id,
                content: memory.content,
                category: memory.category,
                memoryType: memory.memoryType,
                confidence: memory.confidence,
                createdAt: memory.createdAt,
              }))}
            categories={[
              ...new Set(data.memories.map((memory) => memory.category)),
            ]}
            memoryTypes={["observed", "inferred", "confirmed"]}
            onDelete={async (ids) => {
              toast.info(`Would delete ${ids.length} memories`);
              memoryBulkSelection.deselectAll();
            }}
            onRecategorize={async (ids, newCategory) => {
              toast.info(
                `Would recategorize ${ids.length} memories to ${newCategory}`,
              );
              memoryBulkSelection.deselectAll();
            }}
            onChangeType={async (ids, newType) => {
              toast.info(
                `Would change ${ids.length} memories to type ${newType}`,
              );
              memoryBulkSelection.deselectAll();
            }}
            onExport={(memories) => {
              const json = JSON.stringify(memories, null, 2);
              const blob = new Blob([json], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "memories-export.json";
              link.click();
            }}
            onClear={memoryBulkSelection.deselectAll}
          />
        ) : null}
        <label className="field">
          <span>Category</span>
          <select
            value={memoryCategory}
            onChange={(event) => setMemoryCategory(event.target.value)}
          >
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
          {data.memories.length === 0 ? (
            <NoMemoriesEmpty
              onAdd={() =>
                document
                  .querySelector<HTMLTextAreaElement>(
                    "#section-memory textarea",
                  )
                  ?.focus()
              }
            />
          ) : null}
          {data.memories.slice(0, 5).map((memory) => {
            const freshness = getMemoryFreshness(memory);

            return (
              <div
                className={`list-item vertical ${memoryBulkSelection.selectedIds.has(memory.id) ? "selected" : ""} ${highlightedItemId === memory.id ? "selection-highlight" : ""}`}
                id={getItemAnchorId(memory.id)}
                key={memory.id}
                onClick={() => memoryBulkSelection.toggle(memory.id)}
              >
                <div>
                  <strong>{memory.category}</strong>
                  <p>{memory.content}</p>
                </div>
                <div className="approval-actions">
                  <MemoryTypeHelp memoryType={memory.memoryType}>
                    <StatusBadge status={memory.memoryType} />
                  </MemoryTypeHelp>
                  <span className="pill">
                    {Math.round(memory.confidence * 100)}%
                  </span>
                  {freshness !== "fresh" ? (
                    <span className="pill">{freshness.replace("_", " ")}</span>
                  ) : null}
                  <RelativeTime date={memory.createdAt} />
                  {freshness !== "fresh" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void updateMemory(memory.id, "review");
                      }}
                      disabled={isPending}
                    >
                      Review
                    </button>
                  ) : null}
                  {memory.memoryType !== "confirmed" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void updateMemory(memory.id, "confirm");
                      }}
                      disabled={isPending}
                    >
                      Confirm
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </article>

      <article
        className={`card ${showAdvancedOperations ? "advanced-operations-expanded" : "advanced-surface-hidden"}`}
        id="section-integrations"
      >
        <div className="card-header">
          <h2>Integrations</h2>
          <span>{data.integrations.length} adapters</span>
        </div>
        <div className="list-stack">
          {integrationSurfaces.map(({ integration, readiness }) => {
            const isManagedGoogle =
              integration.metadata.provider === "google" &&
              integration.metadata.managed === true;
            const providerActionLabel =
              integration.status === "ready"
                ? "Reconnect Google"
                : "Connect Google";

            return (
              <div className="list-item vertical" key={integration.id}>
                <div>
                  <strong>{integration.name}</strong>
                  <p>
                    {integration.system} · {integration.capabilities.join(", ")}
                  </p>
                  <p>{readiness.reason}</p>
                </div>
                <div className="approval-actions">
                  <StatusBadge status={integration.status} />
                  <StatusBadge status={readiness.tier}>
                    {readiness.label}
                  </StatusBadge>
                  {readiness.supportedModes.length > 0 ? (
                    <span className="pill">
                      {readiness.supportedModes.join(" · ")}
                    </span>
                  ) : null}
                  {isManagedGoogle ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void connectGoogleProvider()}
                      disabled={isPending}
                    >
                      {providerActionLabel}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        void cycleIntegration(
                          integration.id,
                          integration.status,
                        )
                      }
                      disabled={isPending}
                    >
                      Toggle
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </article>

      <article
        className={`card ${showAdvancedOperations ? "advanced-operations-expanded" : "advanced-surface-hidden"}`}
        id="section-notes"
      >
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
          <button
            type="button"
            className="secondary-button"
            onClick={searchNotes}
            disabled={isPending}
          >
            Search
          </button>
        </div>
        <label className="field">
          <span>Title</span>
          <input
            value={noteTitle}
            onChange={(event) => setNoteTitle(event.target.value)}
            placeholder="Example: Travel packing list"
          />
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
          {noteState.message ||
            "Search, open, and edit filesystem-backed notes through the provider-neutral adapter."}
        </p>
        <div className="list-stack">
          {notes.slice(0, 5).map((note) => (
            <div className="list-item vertical" key={note.id}>
              <div>
                <strong>{note.title}</strong>
                <p>
                  {note.content
                    .split("\n")
                    .slice(1)
                    .join(" ")
                    .trim()
                    .slice(0, 180) || "No note body."}
                </p>
              </div>
              <div className="note-meta-row">
                <RelativeTime date={note.updatedAt} />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openLocalNote(note.slug)}
                  disabled={isPending}
                >
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="note-editor">
          <div className="card-header">
            <h3>
              {selectedNotePreview
                ? `Edit ${selectedNotePreview.title}`
                : "Note editor"}
            </h3>
            <span>
              {selectedNotePreview ? selectedNotePreview.slug : "Select a note"}
            </span>
          </div>
          <label className="field">
            <span>Editor title</span>
            <input
              value={selectedNoteTitle}
              onChange={(event) =>
                setSelectedNoteTitleDraft(event.target.value)
              }
              placeholder="Open a note to edit its title"
              disabled={!selectedNoteSlug || isPending}
            />
          </label>
          <textarea
            value={selectedNoteContent}
            onChange={(event) =>
              setSelectedNoteContentDraft(event.target.value)
            }
            placeholder="Open a note to edit its body."
            rows={6}
            disabled={!selectedNoteSlug || isPending}
          />
          <button
            type="button"
            onClick={saveSelectedNote}
            disabled={isPending || !selectedNoteSlug}
          >
            Save selected note
          </button>
        </div>
      </article>

      <article
        className={`card ${showAdvancedOperations ? "advanced-operations-expanded" : "advanced-surface-hidden"}`}
        id="section-watchers"
      >
        <div className="card-header">
          <FeatureHelp feature="watchers">
            <h2>Watchers</h2>
          </FeatureHelp>
          <span>{data.watchers.length} active models</span>
        </div>
        <div className="list-stack">
          {data.watchers.length === 0 ? <NoWatchersEmpty /> : null}
          {data.watchers.map((watcher) => (
            <div
              className={`list-item vertical ${highlightedItemId === watcher.id ? "selection-highlight" : ""}`}
              id={getItemAnchorId(watcher.id)}
              key={watcher.id}
            >
              <div>
                <strong>{watcher.targetEntity}</strong>
                <p>{watcher.condition}</p>
              </div>
              <div className="approval-actions">
                <StatusBadge status={watcher.status} />
                <span className="pill">{watcher.frequency}</span>
                {watcher.status === "active" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void updateWatcher(watcher.id, "pause")}
                    disabled={isPending}
                  >
                    Pause
                  </button>
                ) : null}
                {watcher.status === "paused" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void updateWatcher(watcher.id, "resume")}
                    disabled={isPending}
                  >
                    Resume
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </article>

      <article
        className={`card ${showAdvancedOperations ? "advanced-operations-expanded" : "advanced-surface-hidden"}`}
        id="section-templates"
      >
        <div className="card-header">
          <FeatureHelp feature="templates">
            <h2>Templates</h2>
          </FeatureHelp>
          <span>{templates.length} saved</span>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={loadTemplates}
          disabled={isPending}
        >
          Load templates
        </button>
        <p className={`status-chip ${templateState.kind}`}>
          {templateState.message ||
            "Save completed goals as reusable templates with optional scheduling."}
        </p>
        <div className="list-stack">
          {templates.length === 0 ? (
            <NoTemplatesEmpty onLoad={loadTemplates} />
          ) : null}
          {templates.map((template) => (
            <div className="list-item vertical" key={template.id}>
              <div>
                <strong>{template.name}</strong>
                <p>
                  {template.request.slice(0, 160)}
                  {template.request.length > 160 ? "..." : ""}
                </p>
              </div>
              <div className="goal-item-actions">
                <StatusBadge
                  status={template.schedule.enabled ? "scheduled" : "manual"}
                />
                {template.schedule.enabled ? (
                  <span className="pill">{template.schedule.cron}</span>
                ) : null}
                <RelativeTime date={template.updatedAt} />
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => runTemplate(template.id)}
                  disabled={isPending}
                >
                  Run now
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    deleteTemplate(template.id, template.updatedAt)
                  }
                  disabled={isPending}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article
        className={`card ${showAdvancedOperations ? "advanced-operations-expanded" : "advanced-surface-hidden"}`}
        id="section-agents"
      >
        <div className="card-header">
          <h2>Agents</h2>
          <span>Custom agents</span>
        </div>
        <div className="agents-section">
          <AgentsPanel />
        </div>
      </article>
    </>
  );
}
