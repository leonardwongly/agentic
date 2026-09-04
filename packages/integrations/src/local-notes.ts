import { getRuntimeContext, type RuntimeContext } from "@agentic/runtime-adapters";
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

function isPathWithin(candidatePath: string, allowedRoot: string, context: RuntimeContext): boolean {
  const relative = context.storage.relative(context.storage.resolve(allowedRoot), context.storage.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !context.storage.isAbsolute(relative));
}

function isMissingFileError(error: unknown): boolean {
  // Check for Node.js ENOENT or generic "not found" errors
  if (error instanceof Error) {
    if ("code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    if (error.message.includes("not found") || error.message.includes("File not found")) {
      return true;
    }
  }
  return false;
}

// Resolve the readable slug for a directory entry, or null when the file is not a markdown
// note whose basename satisfies the exact contract enforced by safeNotePath()/readLocalNote().
// Keeping the lister on the same contract guarantees every surfaced id can be opened back.
function noteSlugForEntry(entryName: string): string | null {
  if (!entryName.endsWith(".md")) {
    return null;
  }

  const slug = entryName.slice(0, -".md".length);
  return LocalNoteSlugSchema.safeParse(slug).success ? slug : null;
}

export function defaultLocalNotesBasePath(context?: RuntimeContext): string {
  const runtime = context ?? getRuntimeContext();
  const configured = runtime.env.AGENTIC_NOTES_PATH?.trim();

  if (configured) {
    return runtime.storage.resolve(configured);
  }

  return runtime.storage.join(runtime.cwd(), ".agentic", "notes");
}

export function getLocalNotesRuntimeConfig(basePath?: string, context?: RuntimeContext): LocalNotesRuntimeConfig {
  const runtime = context ?? getRuntimeContext();
  const resolvedBasePath = basePath ?? defaultLocalNotesBasePath(runtime);
  const production = runtime.env.NODE_ENV === "production";
  const explicitlyEnabled = isEnabledFlag(runtime.env.AGENTIC_LOCAL_NOTES_ENABLED);
  const notesPathConfigured = Boolean(runtime.env.AGENTIC_NOTES_PATH?.trim());
  const allowedRoot = runtime.env.AGENTIC_LOCAL_NOTES_ALLOWED_ROOT?.trim();
  const allowedRootConfigured = Boolean(allowedRoot);
  const scoped = !production || (allowedRootConfigured && isPathWithin(resolvedBasePath, allowedRoot!, runtime));

  return {
    enabled: production ? explicitlyEnabled && notesPathConfigured && scoped : true,
    production,
    explicitlyEnabled,
    notesPathConfigured,
    allowedRootConfigured,
    scoped
  };
}

export function getLocalNotesPublicMetadata(basePath?: string, context?: RuntimeContext): Record<string, unknown> {
  const config = getLocalNotesRuntimeConfig(basePath, context);

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

export function isLocalNotesRuntimeEnabled(basePath?: string, context?: RuntimeContext): boolean {
  return getLocalNotesRuntimeConfig(basePath, context).enabled;
}

export function assertLocalNotesRuntimeEnabled(basePath?: string, context?: RuntimeContext): string {
  const runtime = context ?? getRuntimeContext();
  const resolved = runtime.storage.resolve(basePath ?? defaultLocalNotesBasePath(runtime));
  const config = getLocalNotesRuntimeConfig(resolved, runtime);

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

function safeNotePath(basePath: string, slug: string, context: RuntimeContext): string {
  const resolvedBase = context.storage.resolve(basePath);
  const candidate = context.storage.resolve(resolvedBase, `${LocalNoteSlugSchema.parse(slug)}.md`);

  if (candidate !== resolvedBase && !candidate.startsWith(`${resolvedBase}${context.storage.sep}`)) {
    throw new Error("Rejected an unsafe note path.");
  }

  return candidate;
}

export async function ensureLocalNotesDirectory(basePath?: string, context?: RuntimeContext): Promise<string> {
  const runtime = context ?? getRuntimeContext();
  const resolved = assertLocalNotesRuntimeEnabled(basePath, runtime);
  await runtime.storage.mkdir(resolved, { recursive: true });
  return resolved;
}

async function parseLocalNote(notePath: string, context: RuntimeContext): Promise<LocalNoteDocument> {
  let content: string;
  let fileInfo: Awaited<ReturnType<RuntimeContext["storage"]["stat"]>>;

  try {
    const [contentRaw, fileInfoResult] = await Promise.all([
      context.storage.readFile(notePath, "utf8"),
      context.storage.stat(notePath)
    ]);
    content = contentRaw as string;
    fileInfo = fileInfoResult;
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new LocalNoteNotFoundError();
    }

    throw error;
  }

  // Strip a leading BOM once so it never leaks into the parsed title or a re-serialised heading.
  content = content.replace(/^\uFEFF/, "");

  const slug = context.storage.basename(notePath, ".md");
  const titleLine = content.split("\n").find((line) => line.trim().startsWith("# "));
  // Trim before the anchored replace so detection (which trims) and stripping agree; otherwise a
  // leading-whitespace/BOM line matches the finder yet defeats `^#\s+` and reports "# Title".
  const title = titleLine ? titleLine.trim().replace(/^#\s+/, "").trim() : slug.replace(/-/g, " ");

  return LocalNoteDocumentSchema.parse({
    id: slug,
    slug,
    title,
    content,
    createdAt: new Date(fileInfo.birthtimeMs).toISOString(),
    updatedAt: new Date(fileInfo.mtimeMs).toISOString()
  });
}

async function writeNoteAtomically(notePath: string, content: string, context: RuntimeContext): Promise<void> {
  // The adapter's writeFile already handles atomic writes
  await context.storage.writeFile(notePath, content);
}

export async function listLocalNotes(basePath?: string, context?: RuntimeContext): Promise<LocalNoteDocument[]> {
  const runtime = context ?? getRuntimeContext();
  const resolvedBase = await ensureLocalNotesDirectory(basePath, runtime);
  
  let entries: Array<{ name: string; isFile: boolean }>;
  try {
    const rawEntries = await runtime.storage.readdir(resolvedBase, { withFileTypes: true });
    entries = (rawEntries as Array<{ name: string; isFile: boolean }>).filter(
      (entry) => entry.isFile && noteSlugForEntry(entry.name) !== null
    );
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
  
  const notes = await Promise.all(
    entries.map((entry) => parseLocalNote(runtime.storage.join(resolvedBase, entry.name), runtime))
  );

  return notes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function searchLocalNotes(query: string, basePath?: string, context?: RuntimeContext): Promise<LocalNoteDocument[]> {
  const normalized = query.trim().toLowerCase();
  const notes = await listLocalNotes(basePath, context);

  if (!normalized) {
    return notes;
  }

  return notes.filter((note) => {
    const haystack = `${note.title}\n${note.content}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

export async function readLocalNote(slug: string, basePath?: string, context?: RuntimeContext): Promise<LocalNoteDocument> {
  const runtime = context ?? getRuntimeContext();
  const resolvedBase = await ensureLocalNotesDirectory(basePath, runtime);
  return parseLocalNote(safeNotePath(resolvedBase, slug, runtime), runtime);
}

export async function createLocalNote(
  params: { title: string; content: string },
  basePath?: string,
  context?: RuntimeContext
): Promise<LocalNoteDocument> {
  const runtime = context ?? getRuntimeContext();
  const resolvedBase = await ensureLocalNotesDirectory(basePath, runtime);
  const normalized = LocalNoteMutationSchema.parse(params);
  const slug = `${toSlug(normalized.title)}-${runtime.randomUUID().slice(0, 8)}`;
  const notePath = safeNotePath(resolvedBase, slug, runtime);
  const content = `# ${normalized.title}\n\n${normalized.content}\n`;

  await writeNoteAtomically(notePath, content, runtime);
  return readLocalNote(slug, resolvedBase, runtime);
}

export async function updateLocalNote(
  params: { slug: string; content: string; title?: string },
  basePath?: string,
  context?: RuntimeContext
): Promise<LocalNoteDocument> {
  const runtime = context ?? getRuntimeContext();
  const resolvedBase = await ensureLocalNotesDirectory(basePath, runtime);
  const existing = await parseLocalNote(safeNotePath(resolvedBase, LocalNoteSlugSchema.parse(params.slug), runtime), runtime);
  const normalized = LocalNoteMutationSchema.parse({
    title: params.title ?? existing.title,
    content: params.content
  });
  const nextContent = `# ${normalized.title}\n\n${normalized.content}\n`;

  await writeNoteAtomically(safeNotePath(resolvedBase, existing.slug, runtime), nextContent, runtime);
  return readLocalNote(existing.slug, resolvedBase, runtime);
}

export async function seedLocalNotes(basePath?: string, context?: RuntimeContext): Promise<void> {
  const existing = await listLocalNotes(basePath, context);

  if (existing.length > 0) {
    return;
  }

  await createLocalNote(
    {
      title: "Agentic Operating Notes",
      content: `Updated ${nowIso()}\n\nUse this folder for local notes that should be searchable through the provider-neutral notes adapter.`
    },
    basePath,
    context
  );
}
