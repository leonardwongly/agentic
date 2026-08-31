import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { buildSpdxDocument } from "../scripts/generate-sbom";
import {
  buildComplianceEvidenceBundle,
  findMissingComplianceRegistryReferences,
  loadComplianceControlRegistry,
} from "../scripts/collect-compliance-evidence";
import {
  collectRuntimeAuditFindings,
  evaluateRuntimeAuditReport,
  loadRuntimeAuditExceptionFile,
} from "../scripts/runtime-vulnerability-gate";
import {
  checkReleaseContext,
  checkTextFormatting,
  evaluateRepoHygieneSnapshot,
  normalizeRepoPath,
  validateIssueEvidenceMap,
  type IssueEvidenceEntry,
  type IssueEvidenceMap,
} from "../scripts/lib/engineering-hygiene";

// ---------------------------------------------------------------------------
// Fixtures. All scratch state lives under build/ and is removed in afterAll.
// ---------------------------------------------------------------------------

const REQUIRED_EVIDENCE_ISSUES = [199, 245, 246, 247, 248, 249];
const scratchDirs: string[] = [];

function repoRoot(): string {
  return process.cwd();
}

function buildDir(): string {
  const dir = path.join(repoRoot(), "build");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Fresh working directory nested inside build/ (so relative() of a sibling starts with "../"). */
function scratch(prefix = "adversarial-hygiene-root-"): string {
  const dir = mkdtempSync(path.join(buildDir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function writeFileAt(filePath: string, contents: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function writeJsonFile(filePath: string, value: unknown): string {
  return writeFileAt(filePath, JSON.stringify(value));
}

/** Materialize the files that `compliantControl()` references, rooted at `root`. */
function materializeControlTargets(root: string): void {
  writeFileAt(path.join(root, "README.md"), "# Evidence anchor\n");
  writeFileAt(
    path.join(root, "packages/policy/src/index.ts"),
    "export const policy = true;\n",
  );
}

function compliantControl(overrides: Record<string, unknown> = {}) {
  return {
    id: "GOV-01",
    family: "Governance",
    title: "Governance control",
    objective: "Keep governance evidence verifiable.",
    owner: "platform",
    traceability: {
      issueNumbers: [700],
      issueLabels: ["aos-trust-spine"],
      routePaths: [],
    },
    trustBoundaries: ["browser to web"],
    productSurfaces: ["dashboard"],
    codePaths: ["packages/policy/src/index.ts"],
    runbooks: ["README.md"],
    automatedChecks: [
      {
        id: "CHECK-1",
        title: "Policy tests",
        command: "npx vitest run",
        sourcePaths: ["packages/policy/src/index.ts"],
      },
    ],
    evidenceArtifacts: [
      { path: "README.md", description: "Fallback evidence", required: true },
    ],
    risks: ["drift"],
    metrics: ["coverage"],
    ...overrides,
  };
}

function registryDocument(controls: unknown[]): Record<string, unknown> {
  return {
    version: 1,
    reviewedAt: "2026-04-18T00:00:00.000Z",
    owners: ["platform"],
    controls,
  };
}

function validEvidenceEntry(issue: number): IssueEvidenceEntry {
  return {
    issue,
    parent: issue === 199 ? undefined : 199,
    title: `Issue #${issue}`,
    status: "implemented",
    evidence: [
      { kind: "docs", path: "README.md", note: "checked-in document" },
    ],
  };
}

function evidenceMap(entries: IssueEvidenceEntry[]): IssueEvidenceMap {
  return { version: 1, workstream: 199, generatedFor: "issue #199", entries };
}

function fullEvidenceMap(
  overrides: Partial<Record<number, IssueEvidenceEntry[]>> = {},
): IssueEvidenceEntry[] {
  return REQUIRED_EVIDENCE_ISSUES.flatMap(
    (issue) => overrides[issue] ?? [validEvidenceEntry(issue)],
  );
}

afterAll(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Release-context / evidence hygiene gates (siblings of the c9af564 junk-path fix)
// ---------------------------------------------------------------------------

describe("adversarial release-context hygiene", () => {
  it("keeps nested OS junk basenames rejected while probing the remaining path spellings", () => {
    // Regression guard for c9af564: junk basenames must be caught anywhere in the tree.
    expect(
      checkReleaseContext(["docs/release/Thumbs.db", "nested/deep/.DS_Store"]),
    ).toEqual([
      expect.objectContaining({
        path: "docs/release/Thumbs.db",
        kind: "forbidden-path",
      }),
      expect.objectContaining({
        path: "nested/deep/.DS_Store",
        kind: "forbidden-path",
      }),
    ]);

    // Redundant "./" segments cannot be used to dodge the checks.
    expect(normalizeRepoPath("./././.env")).toBe(".env");
    expect(checkReleaseContext(["./././.env"])).toEqual([
      expect.objectContaining({ kind: "forbidden-path" }),
    ]);

    // Regression: the forbidden-basename set is compared lower-cased, so the case variants Explorer
    // and archive tools actually write are caught like the canonical spelling.
    expect(
      checkReleaseContext(["Nested/DEEP/THUMBS.DB", "docs/.ds_store"]),
    ).toEqual([
      expect.objectContaining({
        path: "Nested/DEEP/THUMBS.DB",
        kind: "forbidden-path",
      }),
      expect.objectContaining({
        path: "docs/.ds_store",
        kind: "forbidden-path",
      }),
    ]);

    // Regression: `.env*` is forbidden as a *basename*, so a nested environment file (the realistic
    // leak) can no longer be passed as release context, while reviewed templates stay allowed.
    expect(
      checkReleaseContext([
        "deploy/.env",
        "apps/web/.env.local",
        "packages/api/.env.production",
      ]),
    ).toEqual([
      expect.objectContaining({ path: "deploy/.env", kind: "forbidden-path" }),
      expect.objectContaining({
        path: "apps/web/.env.local",
        kind: "forbidden-path",
      }),
      expect.objectContaining({
        path: "packages/api/.env.production",
        kind: "forbidden-path",
      }),
    ]);
    expect(checkReleaseContext(["deploy/.env.example"])).toEqual([]);

    // Regression: the `.env.example`/`.env.sample` template exemption used to run before the
    // forbidden-directory check, so a same-named file inside a generated/local directory passed
    // the gate. Forbidden directories now take precedence over the template carve-out.
    expect(checkReleaseContext(["node_modules/.env.example"])).toEqual([
      expect.objectContaining({ path: "node_modules/.env.example", kind: "forbidden-path" }),
    ]);
    expect(checkReleaseContext(["dist/secret/.env.sample"])).toEqual([
      expect.objectContaining({ path: "dist/secret/.env.sample", kind: "forbidden-path" }),
    ]);

    // Regression: every lookup is now keyed on a contained repository-relative path, so absolute
    // and "../"-prefixed entries are rejected instead of re-keying the prefix checks to zero hits.
    expect(
      checkReleaseContext([
        "/Users/x/repo/artifacts/security/report.json",
        "/Users/x/repo/node_modules/left-pad/index.js",
        "/Users/x/repo/.env",
        "../../somewhere/else/.env",
      ]),
    ).toEqual([
      expect.objectContaining({
        path: "/Users/x/repo/artifacts/security/report.json",
        kind: "forbidden-path",
        message: expect.stringContaining("repository root"),
      }),
      expect.objectContaining({
        path: "/Users/x/repo/node_modules/left-pad/index.js",
        kind: "forbidden-path",
        message: expect.stringContaining("repository root"),
      }),
      expect.objectContaining({
        path: "/Users/x/repo/.env",
        kind: "forbidden-path",
        message: expect.stringContaining("repository root"),
      }),
      expect.objectContaining({
        path: "../../somewhere/else/.env",
        kind: "forbidden-path",
        message: expect.stringContaining("repository root"),
      }),
    ]);
  });

  it("rejects evidence references that escape the validated root", () => {
    const root = scratch();
    materializeControlTargets(root);
    const outsideFile = writeFileAt(
      path.join(scratch("adversarial-hygiene-outside-"), "credentials.env"),
      "TOKEN=out-of-tree",
    );
    const escaping = path.relative(root, outsideFile);

    // Sanity: the fixture really does point out of the validated root.
    expect(escaping.startsWith("..")).toBe(true);

    const map = evidenceMap(
      fullEvidenceMap({
        245: [
          {
            issue: 245,
            parent: 199,
            title: "Escaping evidence reference",
            status: "implemented",
            evidence: [
              {
                kind: "config",
                path: escaping,
                note: "points outside the repo",
              },
            ],
          },
        ],
      }),
    );

    // Regression: an evidence reference is contained before the filesystem is touched, so a path
    // that leaves the validated root is reported instead of certifying an out-of-tree file.
    expect(validateIssueEvidenceMap(map, { cwd: root })).toEqual([
      expect.objectContaining({
        issue: 245,
        path: escaping,
        message: expect.stringContaining("escapes the validated repository root"),
      }),
    ]);

    // Regression: an absolute evidence path used to be silently re-interpreted as repo-relative by
    // path.join(root, "/etc/x"), which named a path nobody referenced; it is now rejected as an
    // escape without ever reaching the filesystem.
    const absolute = evidenceMap(
      fullEvidenceMap({
        245: [
          {
            issue: 245,
            parent: 199,
            title: "Absolute evidence reference",
            status: "implemented",
            evidence: [
              {
                kind: "config",
                path: "/etc/agentic-does-not-exist",
                note: "absolute",
              },
            ],
          },
        ],
      }),
    );
    expect(validateIssueEvidenceMap(absolute, { cwd: root })).toEqual([
      expect.objectContaining({
        issue: 245,
        path: "/etc/agentic-does-not-exist",
        message: expect.stringContaining("escapes the validated repository root"),
      }),
    ]);
  });

  it("validates evidence-map entry identifiers and parent links before trusting them", () => {
    const root = scratch();
    materializeControlTargets(root);

    const malformedEntries: IssueEvidenceEntry[] = [
      { ...validEvidenceEntry(245), issue: Number.NaN },
      { ...validEvidenceEntry(-5), issue: -5 },
      { ...validEvidenceEntry(245.5), issue: 245.5 },
      {
        ...validEvidenceEntry(246),
        issue: "246",
      } as unknown as IssueEvidenceEntry,
      validEvidenceEntry(246),
    ];

    const issues = validateIssueEvidenceMap(
      evidenceMap(fullEvidenceMap({ 245: malformedEntries })),
      { cwd: root },
    );

    // Regression: each entry identifier is validated up front (positive integer, typed), so the
    // garbage identifiers are reported and can no longer key the dedupe or the parent-link rule.
    // The string "246" is rejected instead of evading the duplicate check against numeric 246.
    expect(issues.map((issue) => issue.issue)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      246,
      245,
    ]);
    expect(issues.map((issue) => issue.message)).toEqual([
      'Evidence map entry identifier "NaN" (type number) must be a positive integer.',
      'Evidence map entry identifier "-5" (type number) must be a positive integer.',
      'Evidence map entry identifier "245.5" (type number) must be a positive integer.',
      'Evidence map entry identifier "246" (type string) must be a positive integer.',
      "Issue #246 appears more than once.",
      "Issue #245 is missing from the evidence map.",
    ]);

    // A non-workstream entry must also carry a typed, positive-integer parent link.
    const untypedParent = validateIssueEvidenceMap(
      evidenceMap(
        fullEvidenceMap({
          245: [
            {
              ...validEvidenceEntry(245),
              parent: "199",
            } as unknown as IssueEvidenceEntry,
          ],
        }),
      ),
      { cwd: root },
    );
    expect(untypedParent.map((issue) => issue.message)).toEqual([
      "Issue #245 must declare a positive integer parent link.",
    ]);
  });

  it("keeps snapshot hygiene findings honest about garbage timestamps and extreme ages", () => {
    const report = evaluateRepoHygieneSnapshot({
      branches: [
        {
          name: "garbage-date",
          lastCommitAt: "not-a-date",
          current: false,
          protected: false,
          merged: false,
        },
        {
          name: "epoch-zero",
          lastCommitAt: "1970-01-01T00:00:00.000Z",
          current: false,
          protected: false,
          merged: false,
        },
      ],
      pullRequests: [
        {
          number: 1,
          title: "stale",
          branch: "stale",
          updatedAt: "not-a-date",
          state: "OPEN",
        },
        {
          number: 2,
          title: "merged-stale",
          branch: "merged-stale",
          updatedAt: "1970-01-01T00:00:00.000Z",
          state: "MERGED",
        },
      ],
      worktrees: [
        {
          path: "wt/dirty",
          branch: "dirty",
          head: "abc",
          dirtyFiles: -1,
          exists: true,
        },
        {
          path: "wt/missing",
          branch: "gone",
          head: "def",
          dirtyFiles: 0,
          exists: false,
        },
      ],
      now: new Date("2026-06-01T00:00:00.000Z"),
      maxAgeDays: 365,
    });

    const kinds = report.findings.map(
      (finding) => `${finding.kind}:${finding.subject}`,
    );
    expect(kinds).toContain("stale-branch:epoch-zero");
    expect(kinds).toContain("missing-worktree:wt/missing");
    expect(report.ok).toBe(true);

    // TRUE BEHAVIOR (fail-open hardening gaps, pinned so a fix has to update this test):
    //  * an unparseable branch/PR timestamp is skipped instead of being reported,
    //  * a negative dirtyFiles count is not treated as dirty.
    // Suggested fix: emit an "unparseable-timestamp" finding when Date.parse is NaN and test
    // `worktree.dirtyFiles !== 0` for the blocker.
    expect(kinds).not.toContain("stale-branch:garbage-date");
    expect(kinds).not.toContain("stale-pr:#1");
    expect(kinds).not.toContain("stale-pr:#2");
    expect(kinds).not.toContain("dirty-worktree:wt/dirty");
  });

  it("flags line endings and final-newline problems on hostile file shapes", () => {
    const issues = checkTextFormatting([
      { path: "docs/a.md", content: "first line\r\nsecond line" },
      {
        path: "docs/b.md",
        content: "alpha\rtrailing space after cr \rgamma\n",
      },
      { path: "docs/c.md", content: "" },
      { path: "docs/d.md", content: "trailing space \n" },
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "docs/a.md", kind: "crlf" }),
        expect.objectContaining({
          path: "docs/a.md",
          kind: "missing-final-newline",
        }),
        expect.objectContaining({
          path: "docs/d.md",
          kind: "trailing-whitespace",
          line: 1,
        }),
      ]),
    );

    // An empty file must not be reported as missing a final newline.
    expect(issues.filter((issue) => issue.path === "docs/c.md")).toEqual([]);

    // TRUE BEHAVIOR: lines are split on "\n" only, so a lone-CR (classic Mac / some CSV
    // exports) file hides trailing whitespace and is never flagged at all.
    // Suggested fix: split on /\r\n|\r|\n/ and flag lone CR as its own kind.
    expect(issues.filter((issue) => issue.path === "docs/b.md")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SBOM content spoofing
// ---------------------------------------------------------------------------

describe("adversarial SBOM inputs", () => {
  it("publishes only verifiable integrity data, purls, and unique element ids", () => {
    const sha512Digest = createHash("sha512").update("left-pad").digest("base64");
    const sha256Digest = createHash("sha256").update("good-sha256").digest("base64");
    const document = buildSpdxDocument(
      {
        lockfileVersion: 3,
        packages: {
          "node_modules/left-pad": { version: "1.3.0", integrity: "sha512-" },
          "node_modules/legacy-md5": {
            version: "1.0.0",
            integrity: "md5-ZmFrZWhhc2h2YWx1ZQ==",
          },
          "node_modules/truncated-sha512": {
            version: "1.0.0",
            integrity: "sha512-ZmFrZQ==",
          },
          "node_modules/good-sha512": {
            version: "1.0.0",
            integrity: `sha512-${sha512Digest}`,
          },
          "node_modules/good-sha256": {
            version: "1.0.0",
            integrity: `sha256-${sha256Digest}`,
          },
          "node_modules/@broken": { version: "2.0.0" },
          "node_modules/a-b": { version: "1.0.0" },
          "node_modules/a/b": { version: "1.0.0" },
        },
      } as never,
      { name: "agentic" },
      new Date("2026-06-01T00:00:00.000Z"),
    );

    const packageByName = (name: string) =>
      document.packages.find((entry) => entry.name === name);

    // Regression: `integrity` is parsed as `<alg>-<base64 digest>` and an SPDX checksum is emitted
    // only for a recognised algorithm whose digest decodes to that algorithm's exact byte length,
    // so neither a digest-less `sha512-` nor a foreign `md5-…` can be welded into a "SHA512" value
    // that a consumer cannot verify. Well-formed ssri values still publish unchanged.
    expect(packageByName("left-pad")?.checksums).toBeUndefined();
    expect(packageByName("legacy-md5")?.checksums).toBeUndefined();
    expect(packageByName("truncated-sha512")?.checksums).toBeUndefined();
    expect(packageByName("good-sha512")?.checksums).toEqual([
      { algorithm: "SHA512", checksumValue: sha512Digest },
    ]);
    expect(packageByName("good-sha256")?.checksums).toEqual([
      { algorithm: "SHA256", checksumValue: sha256Digest },
    ]);

    // Regression: a scope-only package name has no segment after the "/", so no purl is published
    // at all instead of the fabricated `pkg:npm/%40broken/undefined@2.0.0` locator.
    expect(packageByName("@broken")?.externalRefs).toBeUndefined();
    expect(packageByName("left-pad")?.externalRefs?.[0]?.referenceLocator).toBe(
      "pkg:npm/left-pad@1.3.0",
    );

    // Regression: element ids append a digest of the exact lockfile path, so `node_modules/a-b` and
    // `node_modules/a/b` no longer collapse onto one SPDXID and the document-wide ID-uniqueness
    // invariant (with both DEPENDS_ON relationships) holds.
    const collidedPair = document.packages.filter((entry) =>
      entry.SPDXID.startsWith("SPDXRef-Package-node_modules-a-b-"),
    );
    expect(collidedPair.map((entry) => entry.name).sort()).toEqual([
      "a-b",
      "a/b",
    ]);
    expect(
      new Set(collidedPair.map((entry) => entry.SPDXID)).size,
    ).toBe(collidedPair.length);
    expect(
      document.relationships.filter((relationship) =>
        collidedPair.some(
          (entry) => entry.SPDXID === relationship.relatedSpdxElement,
        ),
      ),
    ).toHaveLength(2);
    expect(
      new Set(document.packages.map((entry) => entry.SPDXID)).size,
    ).toBe(document.packages.length);
    expect(
      document.relationships.filter(
        (relationship) => relationship.relationshipType === "DEPENDS_ON",
      ),
    ).toHaveLength(document.packages.length - 1);
  });
});

// ---------------------------------------------------------------------------
// Compliance registry fed hostile config
// ---------------------------------------------------------------------------

describe("adversarial compliance registry inputs", () => {
  it("rejects malformed registry documents instead of defaulting open", () => {
    const root = scratch();

    const cases: Array<[string, unknown, RegExp]> = [
      [
        "array-document",
        [],
        /Unsupported compliance control registry version/u,
      ],
      [
        "missing-controls",
        {
          version: 1,
          reviewedAt: "2026-04-18T00:00:00.000Z",
          owners: ["platform"],
        },
        /must define at least one control/u,
      ],
      [
        "empty-controls",
        registryDocument([]),
        /must define at least one control/u,
      ],
      [
        "empty-owners",
        { ...registryDocument([compliantControl()]), owners: [] },
        /one or more owners/u,
      ],
      [
        "string-version",
        { ...registryDocument([compliantControl()]), version: "1" },
        /Unsupported compliance control registry version/u,
      ],
      [
        "duplicate-ids",
        registryDocument([compliantControl(), compliantControl()]),
        /Duplicate compliance control id/u,
      ],
      [
        "missing-owner",
        registryDocument([compliantControl({ owner: "" })]),
        /must define id, family, title, objective, and owner/u,
      ],
      [
        "empty-code-paths",
        registryDocument([compliantControl({ codePaths: [] })]),
        /must define trust boundaries/u,
      ],
      [
        "missing-traceability",
        registryDocument([compliantControl({ traceability: undefined })]),
        /must define traceability/u,
      ],
      [
        "non-positive-issue",
        registryDocument([
          compliantControl({
            traceability: {
              issueNumbers: [0],
              issueLabels: ["x"],
              routePaths: [],
            },
          }),
        ]),
        /positive integer issue number/u,
      ],
      [
        "blank-label",
        registryDocument([
          compliantControl({
            traceability: {
              issueNumbers: [7],
              issueLabels: ["   "],
              routePaths: [],
            },
          }),
        ]),
        /at least one issue label/u,
      ],
      [
        "non-api-route-path",
        registryDocument([
          compliantControl({
            traceability: {
              issueNumbers: [7],
              issueLabels: ["x"],
              routePaths: ["README.md"],
            },
          }),
        ]),
        /must contain app\/api route files only/u,
      ],
      [
        "untraced-api-route",
        registryDocument([
          compliantControl({
            codePaths: ["apps/web/app/api/agentic-health/route.ts"],
            traceability: {
              issueNumbers: [7],
              issueLabels: ["x"],
              routePaths: [],
            },
          }),
        ]),
        /must match API route code paths/u,
      ],
    ];

    for (const [label, value, expectation] of cases) {
      const filePath = writeJsonFile(
        path.join(root, `registry-${label}.json`),
        value,
      );
      expect(() => loadComplianceControlRegistry(filePath), label).toThrow(
        expectation,
      );
    }

    // TRUE BEHAVIOR (hardening gap): unlike the vulnerability-exception loader, this loader has
    // no unknown-key whitelist, so a fabricated control carrying extra authority keys is
    // accepted and copied verbatim into the published bundle.
    const smuggled = registryDocument([
      compliantControl({ approvedBy: "self", exemptFromAudit: true }),
    ]);
    const smuggledPath = writeJsonFile(
      path.join(root, "registry-smuggled.json"),
      smuggled,
    );
    expect(() => loadComplianceControlRegistry(smuggledPath)).not.toThrow();
  });

  it("refuses to certify files outside the audited repository root", () => {
    const root = scratch();
    materializeControlTargets(root);
    const outsideFile = writeFileAt(
      path.join(scratch("adversarial-hygiene-outside-"), "Dockerfile"),
      "FROM scratch\n",
    );
    const escapingCodePath = path.relative(root, outsideFile);
    const escapingRunbook = path.relative(
      root,
      path.join(repoRoot(), "README.md"),
    );
    expect(escapingCodePath.startsWith("..")).toBe(true);
    expect(escapingRunbook.startsWith("..")).toBe(true);

    const hostileRegistry = registryDocument([
      compliantControl({
        id: "GOV-02",
        codePaths: [escapingCodePath],
        runbooks: [escapingRunbook],
      }),
    ]) as never;

    // Regression: every declared path is normalised and contained at the audited root before it
    // touches the filesystem, so both escapes now surface as missing references, the bundle
    // refuses to publish, and the loader rejects the registry outright instead of letting a
    // crafted `../` entry hash and certify a file the audit has no authority over.
    expect(
      findMissingComplianceRegistryReferences(hostileRegistry, { cwd: root }),
    ).toEqual([
      {
        controlId: "GOV-02",
        kind: "codePath",
        path: escapingCodePath,
      },
      {
        controlId: "GOV-02",
        kind: "runbook",
        path: escapingRunbook,
      },
    ]);

    const hostileRegistryPath = writeJsonFile(
      path.join(root, "registry-out-of-tree.json"),
      hostileRegistry,
    );
    expect(() =>
      loadComplianceControlRegistry(hostileRegistryPath),
    ).toThrow(/out-of-tree codePaths path/u);

    expect(() =>
      buildComplianceEvidenceBundle(hostileRegistry, {
        cwd: root,
        now: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).toThrow(/contains 2 missing file references/iu);

    // Negative control: the target really exists outside the audited root - it was the missing
    // containment check, not a missing file, that used to make it certify.
    expect(existsSync(outsideFile)).toBe(true);
    expect(
      createHash("sha256").update(readFileSync(outsideFile)).digest("hex"),
    ).toHaveLength(64);
  });

  it("refuses to certify a required evidence artifact that points at nothing", () => {
    const root = scratch();
    materializeControlTargets(root);

    const emptyArtifactRegistry = registryDocument([
      compliantControl({
        evidenceArtifacts: [
          {
            path: "",
            description: "Empty path resolves to the working directory",
            required: true,
          },
          { path: ".", description: "Directory itself", required: true },
        ],
      }),
    ]) as never;

    // Regression: a declared evidence artifact must name a non-empty path that resolves to an
    // existing *file*, so `""` and `"."` (which resolve to the audited root directory) are published
    // as missing and the strict `requireArtifacts` gate fails closed instead of certifying nothing.
    expect(() =>
      buildComplianceEvidenceBundle(emptyArtifactRegistry, {
        cwd: root,
        now: new Date("2026-06-01T00:00:00.000Z"),
        requireArtifacts: true,
      }),
    ).toThrow(/missing 2 required artifact/iu);

    const bundle = buildComplianceEvidenceBundle(emptyArtifactRegistry, {
      cwd: root,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(
      bundle.controls[0]?.evidenceArtifacts.map((artifact) => artifact.exists),
    ).toEqual([false, false]);
    expect(bundle.summary.totalRequiredArtifacts).toBe(2);
    expect(bundle.summary.missingRequiredArtifacts).toBe(2);
    expect(bundle.controls[0]?.status).toBe("missing-artifacts");
    expect(bundle.controls[0]?.missingRequiredArtifactPaths).toEqual([
      "",
      ".",
    ]);

    // Contrast: a whitespace path was already reported, so the empty/"." spellings now join it
    // instead of being the only artefact spellings that slip through as satisfied.
    const whitespace = buildComplianceEvidenceBundle(
      registryDocument([
        compliantControl({
          evidenceArtifacts: [
            { path: " ", description: "Blank", required: true },
          ],
        }),
      ]) as never,
      { cwd: root, now: new Date("2026-06-01T00:00:00.000Z") },
    );
    expect(whitespace.summary.missingRequiredArtifacts).toBe(1);
    expect(whitespace.controls[0]?.status).toBe("missing-artifacts");
  });
});

// ---------------------------------------------------------------------------
// Vulnerability exception file fed hostile config
// ---------------------------------------------------------------------------

describe("adversarial runtime vulnerability exceptions", () => {
  it("rejects a package-only exception that would waive every advisory and severity", () => {
    const report = {
      auditReportVersion: 2,
      vulnerabilities: {
        "left-pad": {
          name: "left-pad",
          severity: "critical",
          isDirect: true,
          via: [
            {
              source: 1,
              name: "left-pad",
              dependency: "left-pad",
              severity: "critical",
              title: "Arbitrary code execution",
            },
            {
              source: 2,
              name: "left-pad",
              dependency: "left-pad",
              severity: "critical",
              title: "Prototype pollution",
            },
          ],
        },
        "unknown-sev": {
          name: "unknown-sev",
          severity: "catastrophic",
          via: [
            {
              source: 3,
              name: "unknown-sev",
              dependency: "unknown-sev",
              title: "Unlabelled advisory",
            },
          ],
        },
      },
    } as never;

    // TRUE BEHAVIOR: an unknown severity string is clamped to "moderate" rather than blocking
    // outright, so a mis-labelled advisory still has to earn its own exception.
    expect(
      collectRuntimeAuditFindings(report, "moderate").map(
        (finding) => `${finding.package}:${finding.severity}`,
      ),
    ).toEqual(
      expect.arrayContaining(["left-pad:critical", "unknown-sev:moderate"]),
    );

    const root = scratch();
    const wildcardPath = writeJsonFile(
      path.join(root, "wildcard-exceptions.json"),
      {
        version: 1,
        exceptions: [
          {
            package: "left-pad",
            owner: "team",
            reason: "blanket waiver",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
          {
            package: "unknown-sev",
            owner: "team",
            reason: "blanket waiver",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        ],
      },
    );

    // Regression: the loader now refuses an exception that names no advisory and no severity, so a
    // blanket waiver can no longer be smuggled in through one config line.
    expect(() => loadRuntimeAuditExceptionFile(wildcardPath)).toThrow(
      /must be scoped to an advisoryId and severity/u,
    );

    // Defence in depth: even a hand-built file that bypasses the loader cannot match, because
    // `findMatchingException` requires the advisory id and an equal (never lower) severity - a
    // critical advisory can no longer be silenced by an exception that never mentions a severity.
    const evaluation = evaluateRuntimeAuditReport(
      report,
      { version: 1, exceptions: [{ package: "left-pad", owner: "team", reason: "blanket waiver", expiresAt: "2099-01-01T00:00:00.000Z" }] } as never,
      {
        minimumSeverity: "moderate",
        now: new Date("2026-06-01T00:00:00.000Z"),
      },
    );

    expect(evaluation.summary).toMatchObject({
      findings: 3,
      allowedFindings: 0,
      blockingFindings: 3,
      activeExceptions: 0,
      expiredExceptions: 0,
    });

    // Boundary: expiry exactly at `now` is still honoured (strict `<` comparison) and is also
    // counted as "expiring soon". Pinned so the gate cannot drift to `<=` without a test change.
    const boundaryPath = writeJsonFile(
      path.join(root, "boundary-exceptions.json"),
      {
        version: 1,
        exceptions: [
          {
            package: "left-pad",
            advisoryId: "npm:1",
            severity: "critical",
            owner: "team",
            reason: "expires exactly at evaluation time",
            expiresAt: "2026-06-01T00:00:00.000Z",
          },
        ],
      },
    );
    const boundary = evaluateRuntimeAuditReport(
      report,
      loadRuntimeAuditExceptionFile(boundaryPath),
      {
        minimumSeverity: "moderate",
        now: new Date("2026-06-01T00:00:00.000Z"),
      },
    );
    expect(boundary.summary).toMatchObject({
      allowedFindings: 1,
      blockingFindings: 2,
      expiredExceptions: 0,
      expiringSoonExceptions: 1,
    });
  });

  it("rejects exception files with hostile shapes before any waiver is honoured", () => {
    const root = scratch();

    const cases: Array<[string, unknown, RegExp]> = [
      ["array", [], /must be a JSON object/u],
      ["string", "nope", /must be a JSON object/u],
      ["null", null, /must be a JSON object/u],
      [
        "wrong-version",
        { version: 2, exceptions: [] },
        /Unsupported runtime vulnerability exception schema version/u,
      ],
      [
        "missing-exceptions",
        { version: 1 },
        /must contain an exceptions array/u,
      ],
      [
        "exceptions-object",
        { version: 1, exceptions: {} },
        /must contain an exceptions array/u,
      ],
      [
        "blank-required-fields",
        {
          version: 1,
          exceptions: [
            {
              package: " ",
              owner: "",
              reason: "",
              expiresAt: "2099-01-01T00:00:00.000Z",
            },
          ],
        },
        /must include package, owner, reason, and expiresAt/u,
      ],
      [
        "bad-severity",
        {
          version: 1,
          exceptions: [
            {
              package: "p",
              owner: "o",
              reason: "r",
              severity: "blocker",
              expiresAt: "2099-01-01T00:00:00.000Z",
            },
          ],
        },
        /Invalid severity/u,
      ],
      [
        "date-only-expiry",
        {
          version: 1,
          exceptions: [
            { package: "p", owner: "o", reason: "r", expiresAt: "2099-01-01" },
          ],
        },
        /Invalid expiresAt/u,
      ],
      [
        "offset-expiry",
        {
          version: 1,
          exceptions: [
            {
              package: "p",
              owner: "o",
              reason: "r",
              expiresAt: "2099-01-01T00:00:00+02:00",
            },
          ],
        },
        /Invalid expiresAt/u,
      ],
      [
        "unknown-field",
        {
          version: 1,
          exceptions: [
            {
              package: "p",
              owner: "o",
              reason: "r",
              expiresAt: "2099-01-01T00:00:00.000Z",
              approvedBy: "me",
            },
          ],
        },
        /Unknown field "approvedBy"/u,
      ],
    ];

    for (const [label, value, expectation] of cases) {
      const filePath = writeJsonFile(
        path.join(root, `exceptions-${label}.json`),
        value,
      );
      expect(() => loadRuntimeAuditExceptionFile(filePath), label).toThrow(
        expectation,
      );
    }

    // The scratch fixtures stay inside build/ and are cleaned up by afterAll.
    expect(existsSync(path.join(root, "exceptions-null.json"))).toBe(true);
  });
});
