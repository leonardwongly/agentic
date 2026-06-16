import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Compensating control for M1 / issue #984: the Content-Security-Policy ships
// with `script-src 'self' 'unsafe-inline'` because the Cloudflare Workers target
// (@opennextjs/cloudflare) cannot run Next.js Node middleware and therefore
// cannot emit a per-request nonce. With `'unsafe-inline'` active, CSP is not a
// reliable second layer against XSS, so the app must contain NO raw-HTML
// injection sinks. This guard fails the build if one is ever introduced, keeping
// the documented tradeoff safe (XSS prevention rests on React's auto-escaping).

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(repoRoot, "apps", "web");

const SCAN_DIRECTORIES = ["app", "components", "lib"].map((dir) => path.join(webRoot, dir));
const SKIP_DIRECTORIES = new Set([".next", ".open-next", ".wrangler", "node_modules", ".agentic"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

// Raw-HTML sinks that bypass React's escaping and would re-open XSS under the
// `'unsafe-inline'` CSP. `eval`/`new Function` are included as script-injection
// vectors that `'unsafe-inline'` would not block either.
const FORBIDDEN_SINKS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /dangerouslySetInnerHTML/, label: "dangerouslySetInnerHTML" },
  { pattern: /\.innerHTML\s*=/, label: "innerHTML assignment" },
  { pattern: /\.outerHTML\s*=/, label: "outerHTML assignment" },
  { pattern: /insertAdjacentHTML\s*\(/, label: "insertAdjacentHTML" },
  { pattern: /document\.write\s*\(/, label: "document.write" },
  { pattern: /\beval\s*\(/, label: "eval" },
  { pattern: /\bnew\s+Function\s*\(/, label: "new Function" }
];

function collectSourceFiles(dir: string): string[] {
  let entries: string[];

  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) {
      continue;
    }

    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("web UI has no raw-HTML/script XSS sinks (CSP unsafe-inline compensating control)", () => {
  const sourceFiles = SCAN_DIRECTORIES.flatMap((dir) => collectSourceFiles(dir));

  it("scans a non-trivial number of source files", () => {
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  it("contains no forbidden HTML/script injection sinks", () => {
    const violations: string[] = [];

    for (const file of sourceFiles) {
      const contents = readFileSync(file, "utf8");

      for (const { pattern, label } of FORBIDDEN_SINKS) {
        if (pattern.test(contents)) {
          violations.push(`${path.relative(repoRoot, file)} -> ${label}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
