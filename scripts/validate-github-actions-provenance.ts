import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkflowActionUse {
  filePath: string;
  line: number;
  value: string;
  ref: string | null;
}

export interface WorkflowActionPinFinding {
  filePath: string;
  line: number;
  value: string;
  reason: string;
}

const WORKFLOW_EXTENSIONS = new Set([".yml", ".yaml"]);
const FULL_SHA_REF = /^[a-f0-9]{40}$/u;

function parseArgs(argv: string[]) {
  let workflowsDir = ".github/workflows";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg !== "--workflows-dir") {
      throw new Error(`Unknown argument: ${arg}`);
    }

    if (!next) {
      throw new Error("Missing value for --workflows-dir.");
    }

    workflowsDir = next;
    index += 1;
  }

  return { workflowsDir };
}

function stripInlineComment(value: string): string {
  let quote: "\"" | "'" | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const previous = value[index - 1];

    if ((character === "\"" || character === "'") && previous !== "\\") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }

    if (character === "#" && quote === null && (index === 0 || /\s/u.test(previous))) {
      return value.slice(0, index).trim();
    }
  }

  return value.trim();
}

function trimYamlScalar(value: string): string {
  const stripped = stripInlineComment(value);
  if (
    (stripped.startsWith("\"") && stripped.endsWith("\"")) ||
    (stripped.startsWith("'") && stripped.endsWith("'"))
  ) {
    return stripped.slice(1, -1);
  }

  return stripped;
}

function getIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function parseYamlKeyValueLine(line: string): { indent: number; key: string; value: string } | null {
  const match = line.match(/^(\s*)(?:-\s*)?([A-Za-z_][\w-]*)\s*:(?:\s+(.+)|\s*)$/u);
  if (!match) {
    return null;
  }

  return {
    indent: match[1].length,
    key: match[2],
    value: match[3] ?? ""
  };
}

function isBlockScalarValue(value: string): boolean {
  return /^[>|](?:(?:[+-]?[1-9])|(?:[1-9][+-]?)|[+-])?(?:\s+#.*)?$/u.test(value.trim());
}

export function collectWorkflowActionUses(filePath: string, content: string): WorkflowActionUse[] {
  const uses: WorkflowActionUse[] = [];
  const lines = content.split(/\r?\n/u);
  let blockScalarIndent: number | null = null;

  lines.forEach((lineContent, index) => {
    const lineIndent = getIndent(lineContent);
    if (blockScalarIndent !== null) {
      if (lineContent.trim() === "" || lineIndent > blockScalarIndent) {
        return;
      }
      blockScalarIndent = null;
    }

    const parsedLine = parseYamlKeyValueLine(lineContent);
    if (!parsedLine) {
      return;
    }

    if (isBlockScalarValue(parsedLine.value)) {
      blockScalarIndent = parsedLine.indent;
    }

    if (parsedLine.key !== "uses") {
      return;
    }

    const value = trimYamlScalar(parsedLine.value);
    const refSeparator = value.lastIndexOf("@");
    uses.push({
      filePath,
      line: index + 1,
      value,
      ref: refSeparator >= 0 ? value.slice(refSeparator + 1) : null
    });
  });

  return uses;
}

export function validateWorkflowActionPins(workflowUses: WorkflowActionUse[]): WorkflowActionPinFinding[] {
  const findings: WorkflowActionPinFinding[] = [];

  for (const actionUse of workflowUses) {
    if (actionUse.value.startsWith("./") || actionUse.value.startsWith("docker://")) {
      continue;
    }

    if (!actionUse.ref) {
      findings.push({
        ...actionUse,
        reason: "External GitHub Action reference must include an immutable commit SHA."
      });
      continue;
    }

    if (!FULL_SHA_REF.test(actionUse.ref)) {
      findings.push({
        ...actionUse,
        reason: "External GitHub Action reference must be pinned to a 40-character lowercase commit SHA."
      });
    }
  }

  return findings;
}

export function collectWorkflowFiles(workflowsDir: string): string[] {
  const resolvedDir = path.resolve(process.cwd(), workflowsDir);
  return readdirSync(resolvedDir)
    .filter((entry) => WORKFLOW_EXTENSIONS.has(path.extname(entry)))
    .map((entry) => path.join(resolvedDir, entry))
    .sort((left, right) => left.localeCompare(right));
}

function main() {
  const { workflowsDir } = parseArgs(process.argv.slice(2));
  const workflowFiles = collectWorkflowFiles(workflowsDir);
  const workflowUses = workflowFiles.flatMap((filePath) =>
    collectWorkflowActionUses(path.relative(process.cwd(), filePath), readFileSync(filePath, "utf8"))
  );
  const findings = validateWorkflowActionPins(workflowUses);

  if (findings.length === 0) {
    console.log(`GitHub Actions provenance pin validation passed for ${workflowFiles.length} workflow file(s).`);
    return;
  }

  console.error("GitHub Actions provenance pin validation failed:");
  for (const finding of findings) {
    console.error(`- ${finding.filePath}:${finding.line} ${finding.value}: ${finding.reason}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
