import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { nowIso } from "@agentic/contracts";

export const LocalNoteDocumentSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  path: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type LocalNoteDocument = z.infer<typeof LocalNoteDocumentSchema>;

const LocalNoteMutationSchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(10_000)
});

const LocalNoteSlugSchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/);

export function defaultLocalNotesBasePath(): string {
  const configured = process.env.AGENTIC_NOTES_PATH?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), ".agentic", "notes");
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
  const resolved = path.resolve(basePath);
  await mkdir(resolved, { recursive: true });
  return resolved;
}

async function parseLocalNote(notePath: string): Promise<LocalNoteDocument> {
  const [content, fileInfo] = await Promise.all([readFile(notePath, "utf8"), stat(notePath)]);
  const slug = path.basename(notePath, ".md");
  const titleLine = content.split("\n").find((line) => line.trim().startsWith("# "));
  const title = titleLine ? titleLine.replace(/^#\s+/, "").trim() : slug.replace(/-/g, " ");

  return LocalNoteDocumentSchema.parse({
    id: slug,
    slug,
    title,
    content,
    path: notePath,
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
  await ensureLocalNotesDirectory(basePath);
  return parseLocalNote(safeNotePath(basePath, slug));
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
  const existing = await readLocalNote(LocalNoteSlugSchema.parse(params.slug), basePath);
  const normalized = LocalNoteMutationSchema.parse({
    title: params.title ?? existing.title,
    content: params.content
  });
  const nextContent = `# ${normalized.title}\n\n${normalized.content}\n`;

  await writeNoteAtomically(existing.path, nextContent);
  return readLocalNote(existing.slug, basePath);
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
