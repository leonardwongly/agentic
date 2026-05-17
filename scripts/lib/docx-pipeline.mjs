import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import JSZip from "jszip";

const execFile = promisify(execFileCallback);

export const paths = {
  root: process.cwd(),
  spec: path.join(process.cwd(), "docs", "specs", "agentic.md"),
  template: path.join(process.cwd(), "docs", "templates", "reference.docx"),
  buildDir: path.join(process.cwd(), "build"),
  outputDocx: path.join(process.cwd(), "build", "agentic.docx"),
  outputPdf: path.join(process.cwd(), "build", "agentic.pdf")
};

const REQUIRED_ZIP_ENTRIES = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/core.xml",
  "word/document.xml"
];

const REQUIRED_HEADINGS = [
  "Purpose",
  "Architecture",
  "Capability Model",
  "Delivery Roadmap",
  "Document Source of Truth"
];

const REQUIRED_TABLE_TERMS = ["Phase", "Outcome", "Key additions"];
const PORTABLE_REFERENCE_SCAN_TARGETS = ["README.md", "docs", ".github", "config"];
const PORTABLE_REFERENCE_TEXT_EXTENSIONS = new Set([".json", ".md", ".mdx", ".toml", ".yaml", ".yml"]);
const NON_PORTABLE_REFERENCE_PATTERNS = [
  {
    id: "local-home-path",
    pattern: /\/Users\/[^\s)`"']+/gu,
    message: "Use a repo-relative path or GitHub URL instead of a local /Users path."
  },
  {
    id: "codex-worktree-path",
    pattern: /\.codex\/worktrees[^\s)`"']*/gu,
    message: "Do not commit Codex worktree paths into docs or config evidence."
  }
];

function isoWithoutMillis(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureBuildDir() {
  await mkdir(paths.buildDir, { recursive: true });
}

export async function renderDocx() {
  await ensureBuildDir();

  await execFile("pandoc", [
    paths.spec,
    "--from=markdown",
    "--to=docx",
    "--reference-doc",
    paths.template,
    "--toc",
    "--output",
    paths.outputDocx
  ]);

  return normalizeDocxMetadata(paths.outputDocx);
}

export async function normalizeDocxMetadata(docxPath) {
  const input = await readFile(docxPath);
  const zip = await JSZip.loadAsync(input);
  const timestamp = isoWithoutMillis();
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml("Agentic")}</dc:title>
  <dc:creator>${escapeXml("Codex")}</dc:creator>
  <cp:lastModifiedBy>${escapeXml("Codex")}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`;

  zip.file("docProps/core.xml", coreXml);
  await writeFile(docxPath, await zip.generateAsync({ type: "nodebuffer" }));

  return {
    docxPath,
    title: "Agentic",
    creator: "Codex",
    timestamp
  };
}

export async function inspectDocx(docxPath) {
  const input = await readFile(docxPath);
  const zip = await JSZip.loadAsync(input);
  const entries = Object.keys(zip.files).sort();
  const coreXml = await zip.file("docProps/core.xml")?.async("string");

  return {
    entries,
    coreXml: coreXml ?? "",
    zip
  };
}

export async function extractDocxToMarkdown(docxPath) {
  const { stdout } = await execFile("pandoc", [docxPath, "--to=markdown"]);
  return stdout;
}

export async function renderPdfSmoke(docxPath = paths.outputDocx) {
  const sofficeAvailable = await fileExists("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  const sofficeBinary = sofficeAvailable ? "/Applications/LibreOffice.app/Contents/MacOS/soffice" : "soffice";

  try {
    await execFile(sofficeBinary, ["--headless", "--convert-to", "pdf", "--outdir", paths.buildDir, docxPath]);

    return {
      attempted: true,
      skipped: false,
      outputPath: paths.outputPdf
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/ENOENT|not found/i.test(message)) {
      return {
        attempted: false,
        skipped: true,
        reason: "LibreOffice is not installed; skipping PDF smoke render."
      };
    }

    throw error;
  }
}

export async function validateDocx(docxPath = paths.outputDocx) {
  const portableReferenceResult = await validatePortableDocReferences();
  const exists = await fileExists(docxPath);

  if (!exists) {
    throw new Error(`Missing docx artifact at ${docxPath}.`);
  }

  const fileInfo = await stat(docxPath);

  if (fileInfo.size === 0) {
    throw new Error("Generated docx is empty.");
  }

  const { entries, coreXml } = await inspectDocx(docxPath);

  for (const entry of REQUIRED_ZIP_ENTRIES) {
    if (!entries.includes(entry)) {
      throw new Error(`Docx package is missing required entry ${entry}.`);
    }
  }

  const extractedMarkdown = await extractDocxToMarkdown(docxPath);

  for (const heading of REQUIRED_HEADINGS) {
    if (!extractedMarkdown.includes(heading)) {
      throw new Error(`Docx text did not contain required heading "${heading}".`);
    }
  }

  for (const term of REQUIRED_TABLE_TERMS) {
    if (!extractedMarkdown.includes(term)) {
      throw new Error(`Docx text did not contain expected table term "${term}".`);
    }
  }

  if (!coreXml.includes("<dc:title>Agentic</dc:title>")) {
    throw new Error("Normalized title metadata was not found in docProps/core.xml.");
  }

  if (!coreXml.includes("<dc:creator>Codex</dc:creator>")) {
    throw new Error("Normalized creator metadata was not found in docProps/core.xml.");
  }

  const pdfSmoke = await renderPdfSmoke(docxPath);

  return {
    docxPath,
    fileSize: fileInfo.size,
    extractedMarkdownLength: extractedMarkdown.length,
    portableReferences: portableReferenceResult,
    metadataNormalized: true,
    tocSmokePassed: extractedMarkdown.includes("Delivery Roadmap"),
    pdfSmoke
  };
}

export async function cleanBuildArtifacts() {
  await rm(paths.outputDocx, { force: true });
  await rm(paths.outputPdf, { force: true });
}

async function collectPortableReferenceFiles(target, files = []) {
  const targetInfo = await stat(target).catch(() => null);

  if (!targetInfo) {
    return files;
  }

  if (targetInfo.isDirectory()) {
    const entries = await readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      await collectPortableReferenceFiles(path.join(target, entry.name), files);
    }
    return files;
  }

  if (PORTABLE_REFERENCE_TEXT_EXTENSIONS.has(path.extname(target)) || path.basename(target) === "README.md") {
    files.push(target);
  }

  return files;
}

export function findNonPortableReferences(content) {
  const violations = [];
  const lineStarts = [0];

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  for (const definition of NON_PORTABLE_REFERENCE_PATTERNS) {
    definition.pattern.lastIndex = 0;
    for (const match of content.matchAll(definition.pattern)) {
      const start = match.index ?? 0;
      const lineIndex = lineStarts.findLastIndex(lineStart => lineStart <= start);
      const lineStart = lineStarts[lineIndex] ?? 0;

      violations.push({
        id: definition.id,
        value: match[0],
        line: lineIndex + 1,
        column: start - lineStart + 1,
        message: definition.message
      });
    }
  }

  return violations;
}

export async function validatePortableDocReferences(options = {}) {
  const root = options.root ?? paths.root;
  const targets = options.targets ?? PORTABLE_REFERENCE_SCAN_TARGETS;
  const files = [];
  const violations = [];

  for (const target of targets) {
    await collectPortableReferenceFiles(path.resolve(root, target), files);
  }

  for (const file of files.sort()) {
    const content = await readFile(file, "utf8");
    const fileViolations = findNonPortableReferences(content);
    const relativePath = path.relative(root, file);

    for (const violation of fileViolations) {
      violations.push({
        ...violation,
        file: relativePath
      });
    }
  }

  if (violations.length > 0) {
    const details = violations
      .map(violation => `${violation.file}:${violation.line}:${violation.column} ${violation.message} (${violation.value})`)
      .join("\n");
    throw new Error(`Found non-portable documentation references:\n${details}`);
  }

  return {
    checkedFiles: files.length,
    violations
  };
}
