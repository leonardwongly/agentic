import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { nowIso } from "@agentic/contracts";
import { LocalNoteDocumentSchema, type LocalNoteDocument } from "./local-notes-schema";

const LocalNoteMutationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(10_000)
});

const LocalNoteSlugSchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/);
const LOCAL_NOTES_ENABLE_VALUES = new Set(["1", "true", "yes", "on"]);

export class LocalNotesConfigurationError extends Error {
  constructor(message = "Local notes are disabled for this runtime.") {
    super(message);
    this.name = "LocalNotesConfigurationError";
  }
}

export class LocalNoteNotFoundError extends Error {
  constructor() {
    super("Local note was not found.");
    this.name = "LocalNoteNotFoundError";
  }
}

export type LocalNotesRuntimeConfig = {
  enabled: boolean;
  production: boolean;
  explicitlyEnabled: boolean;
  notesPathConfigured: boolean;
  allowedRootConfigured: boolean;
  scoped: boolean;
};

function isEnabledFlag(value: string | undefined): boolean {
  return LOCAL_NOTES_ENABLE_VALUES.has(value?.trim().toLowerCase() ?? "");
}

function isPathWithin(candidatePath: string, allowedRoot: string): boolean {
  const relative = path.relative(path.resolve(allowedRoot), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function defaultLocalNotesBasePath(): string {
  const configured = process.env.AGENTIC_NOTES_PATH?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), ".agentic", "notes");
}

export function getLocalNotesRuntimeConfig(basePath = defaultLocalNotesBasePath()): LocalNotesRuntimeConfig {
  const production = process.env.NODE_ENV === "production";
  const explicitlyEnabled = isEnabledFlag(process.env.AGENTIC_LOCAL_NOTES_ENABLED);
  const notesPathConfigured = Boolean(process.env.AGENTIC_NOTES_PATH?.trim());
  const allowedRoot = process.env.AGENTIC_LOCAL_NOTES_ALLOWED_ROOT?.trim();
  const allowedRootConfigured = Boolean(allowedRoot);
  const scoped = !production || (allowedRootConfigured && isPathWithin(basePath, allowedRoot!));

  return {
    enabled: production ? explicitlyEnabled && notesPathConfigured && scoped : true,
    production,
    explicitlyEnabled,
    notesPathConfigured,
    allowedRootConfigured,
    scoped
  };
}

export function getLocalNotesPublicMetadata(basePath = defaultLocalNotesBasePath()): Record<string, unknown> {
  const config = getLocalNotesRuntimeConfig(basePath);

  return {
    provider: "local-filesystem",
    storage: "local-markdown",
    enabled: config.enabled,
    productionGate: config.production,
    explicitlyEnabled: config.explicitlyEnabled,
    notesPathConfigured: config.notesPathConfigured,
    allowedRootConfigured: config.allowedRootConfigured,
    scoped: config.scoped
  };
}

export function isLocalNotesRuntimeEnabled(basePath = defaultLocalNotesBasePath()): boolean {
  return getLocalNotesRuntimeConfig(basePath).enabled;
}

export function assertLocalNotesRuntimeEnabled(basePath = defaultLocalNotesBasePath()): string {
  const resolved = path.resolve(basePath);
  const config = getLocalNotesRuntimeConfig(resolved);

  if (!config.enabled) {
    throw new LocalNotesConfigurationError(
      "Local notes are disabled in production until AGENTIC_LOCAL_NOTES_ENABLED=true, AGENTIC_NOTES_PATH, and AGENTIC_LOCAL_NOTES_ALLOWED_ROOT are configured with the notes path under the allowed root."
    );
  }

  return resolved;
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note";
}

function safeNotePath(basePath: string, slug: string): string {
  const resolvedBase = path.resolve(basePath);
  const candidate = path.resolve(resolvedBase, `${LocalNoteSlugSchema.parse(slug)}.md`);

  if (candidate !== resolvedBase && !candidate.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error("Rejected an unsafe note path.");
  }

  return candidate;
}

export async function ensureLocalNotesDirectory(basePath = defaultLocalNotesBasePath()): Promise<string> {
  const resolved = assertLocalNotesRuntimeEnabled(basePath);
  await mkdir(resolved, { recursive: true });
  return resolved;
}

async function parseLocalNote(notePath: string): Promise<LocalNoteDocument> {
  let content: string;
  let fileInfo: Awaited<ReturnType<typeof stat>>;

  try {
    [content, fileInfo] = await Promise.all([readFile(notePath, "utf8"), stat(notePath)]);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new LocalNoteNotFoundError();
    }

    throw error;
  }

  const slug = path.basename(notePath, ".md");
  const titleLine = content.split("\n").find((line) => line.trim().startsWith("# "));
  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : slug.replace(/-/g, " ");

  return LocalNoteDocumentSchema.parse({
    id: slug,
    slug,
    title,
    content,
    createdAt: fileInfo.birthtime.toISOString(),
    updatedAt: fileInfo.mtime.toISOString()
  });
}

async function writeNoteAtomically(notePath: string, content: string): Promise<void> {
  const tempPath = `${notePath}.${crypto.randomUUID()}.tmp`;

  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, notePath);
}

export async function listLocalNotes(basePath = defaultLocalNotesBasePath()): Promise<LocalNoteDocument[]> {
  const resolvedBase = await ensureLocalNotesDirectory(basePath);
  const entries = await readdir(resolvedBase, { withFileTypes: true });
  const notes = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => parseLocalNote(path.join(resolvedBase, entry.name)))
  );

  return notes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function searchLocalNotes(query: string, basePath = defaultLocalNotesBasePath()): Promise<LocalNoteDocument[]> {
  const normalized = query.trim().toLowerCase();
  const notes = await listLocalNotes(basePath);

  if (!normalized) {
    return notes;
  }

  return notes.filter((note) => {
    const haystack = `${note.title}\n${note.content}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

export async function readLocalNote(slug: string, basePath = defaultLocalNotesBasePath()): Promise<LocalNoteDocument> {
  const resolvedBase = await ensureLocalNotesDirectory(basePath);
  return parseLocalNote(safeNotePath(resolvedBase, slug));
}

export async function createLocalNote(
  params: { title: string; content: string },
  basePath = defaultLocalNotesBasePath()
): Promise<LocalNoteDocument> {
  const resolvedBase = await ensureLocalNotesDirectory(basePath);
  const normalized = LocalNoteMutationSchema.parse(params);
  const slug = `${toSlug(normalized.title)}-${crypto.randomUUID().slice(0, 8)}`;
  const notePath = safeNotePath(resolvedBase, slug);
  const content = `# ${normalized.title}\n\n${normalized.content}\n`;

  await writeNoteAtomically(notePath, content);
  return readLocalNote(slug, resolvedBase);
}

export async function updateLocalNote(
  params: { slug: string; content: string; title?: string },
  basePath = defaultLocalNotesBasePath()
): Promise<LocalNoteDocument> {
  const resolvedBase = await ensureLocalNotesDirectory(basePath);
  const existing = await parseLocalNote(safeNotePath(resolvedBase, LocalNoteSlugSchema.parse(params.slug)));
  const normalized = LocalNoteMutationSchema.parse({
    title: params.title ?? existing.title,
    content: params.content
  });
  const nextContent = `# ${normalized.title}\n\n${normalized.content}\n`;

  await writeNoteAtomically(safeNotePath(resolvedBase, existing.slug), nextContent);
  return readLocalNote(existing.slug, resolvedBase);
}

export async function seedLocalNotes(basePath = defaultLocalNotesBasePath()): Promise<void> {
  const existing = await listLocalNotes(basePath);

  if (existing.length > 0) {
    return;
  }

  await createLocalNote(
    {
      title: "Agentic Operating Notes",
      content: `Updated ${nowIso()}\n\nUse this folder for local notes that should be searchable through the provider-neutral notes adapter.`
    },
    basePath
  );
}
