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

    // DEFECT: the forbidden-*base*namen set is compared case-sensitively while only the
    // *prefix* check is lower-cased, so a case-variant junk file that c9af564 was meant to
    // catch survives ("THUMBS.DB" is exactly what Explorer writes on some volumes).
    // Suggested fix: compare `basename.toLowerCase()` against a lower-cased basename set.
    expect(
      checkReleaseContext(["Nested/DEEP/THUMBS.DB", "docs/.ds_store"]),
    ).toEqual([]);

    // DEFECT: `.env` / `.env.local` are in FORBIDDEN_EXACT, which is matched against the whole
    // normalized path, so any nested environment file (the realistic leak) is accepted as
    // release context even though the root-level one is blocked.
    // Suggested fix: move dotfile env names into the basename set (case-insensitively).
    expect(
      checkReleaseContext([
        "deploy/.env",
        "apps/web/.env.local",
        "packages/api/.env.production",
      ]),
    ).toEqual([]);

    // DEFECT: there is no root containment, and every prefix is anchored, so an absolute path
    // (or "../" traversal) re-keys the whole prefix/lookup: generated artifacts, node_modules
    // and secrets all walk free. ".DS_Store" is only caught here by accident of basename().
    // Suggested fix: reject `path.posix.isAbsolute(relativePath)` and any "../" segment.
    expect(
      checkReleaseContext([
        "/Users/x/repo/artifacts/security/report.json",
        "/Users/x/repo/node_modules/left-pad/index.js",
        "/Users/x/repo/.env",
        "../../somewhere/else/.env",
      ]),
    ).toEqual([]);
  });

  it("accepts evidence references that escape the validated root", () => {
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

    // DEFECT: validateIssueEvidenceMap only asserts existsSync(cwd + evidencePath), and
    // path.join happily walks out of the root, so a hostile evidence map can certify issues
    // against files that are not part of the repository at all.
    // Suggested fix: after normalizeRepoPath, reject absolute paths and any "../" segment
    // before touching the filesystem.
    expect(validateIssueEvidenceMap(map, { cwd: root })).toEqual([]);

    // TRUE BEHAVIOR: an absolute evidence path is silently re-interpreted as repo-relative
    // (path.join(root, "/etc/x") === root + "/etc/x"), so the reported finding names a path
    // that nobody referenced and the real target is never checked.
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
        message: expect.stringContaining("missing evidence path"),
      }),
    ]);
  });

  it("validates nothing about evidence-map entry shape, so garbage identifiers slip through", () => {
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

    // DEFECT: the only identifier findings are the duplicate #246 and the missing #245.
    // NaN is never deduplicated (Set uses SameValueZero), -5 / 245.5 / the string "246" are all
    // accepted as issue identifiers, and the "must link back to parent #199" rule is silently
    // skipped for NaN because every comparison against NaN is false. A string "246" also evades
    // the duplicate check against numeric 246, so the same issue can be certified twice.
    // Suggested fix: validate each entry up front with Number.isInteger(entry.issue) &&
    // entry.issue > 0 (plus typeof entry.parent === "number" for non-workstream entries).
    expect(issues.map((issue) => issue.issue)).toEqual([246, 245]);
    expect(issues.map((issue) => issue.message)).toEqual([
      "Issue #246 appears more than once.",
      "Issue #245 is missing from the evidence map.",
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
  it("copies unverified integrity and identifier data straight into the SPDX document", () => {
    const document = buildSpdxDocument(
      {
        lockfileVersion: 3,
        packages: {
          "node_modules/left-pad": { version: "1.3.0", integrity: "sha512-" },
          "node_modules/legacy-md5": {
            version: "1.0.0",
            integrity: "md5-ZmFrZWhhc2h2YWx1ZQ==",
          },
          "node_modules/@broken": { version: "2.0.0" },
          "node_modules/a-b": { version: "1.0.0" },
          "node_modules/a/b": { version: "1.0.0" },
        },
      } as never,
      { name: "agentic" },
      new Date("2026-06-01T00:00:00.000Z"),
    );

    const truncated = document.packages.find(
      (entry) => entry.SPDXID === "SPDXRef-Package-node_modules-left-pad",
    );
    const foreignAlgorithm = document.packages.find(
      (entry) => entry.SPDXID === "SPDXRef-Package-node_modules-legacy-md5",
    );
    const brokenScope = document.packages.find(
      (entry) => entry.name === "@broken",
    );
    const collidedIds = document.packages.filter(
      (entry) => entry.SPDXID === "SPDXRef-Package-node_modules-a-b",
    );

    // DEFECT: `dependency.integrity` is copied verbatim and always labelled "SHA512" after only
    // stripping a leading "sha512-", so a truncated digest becomes an empty checksumValue and a
    // foreign-algorithm digest is published as a SHA512 checksum with "md5-" welded into the
    // value. An SBOM consumer cannot tell the difference and verification fails on garbage.
    // Suggested fix: parse `<alg>-<digest>`, emit only recognised algorithms, and require the
    // expected digest shape before emitting a checksum entry.
    expect(truncated?.checksums).toEqual([
      { algorithm: "SHA512", checksumValue: "" },
    ]);
    expect(foreignAlgorithm?.checksums).toEqual([
      { algorithm: "SHA512", checksumValue: "md5-ZmFrZWhhc2h2YWx1ZQ==" },
    ]);

    // DEFECT: a scope-only package name contains no "/", so name.split("/") yields an undefined
    // package segment and the published purl silently becomes ".../undefined@<version>".
    // Suggested fix: require a package segment after the scope, else emit NOASSERTION.
    expect(brokenScope?.externalRefs?.[0]?.referenceLocator).toBe(
      "pkg:npm/%40broken/undefined@2.0.0",
    );

    // DEFECT: slugify() is lossy, so two distinct lockfile paths collapse onto one SPDXID and
    // break the SPDX ID-uniqueness invariant (a consumer resolves one entry and silently drops
    // the other, together with its DEPENDS_ON relationship).
    // Suggested fix: derive the ID from a hash of the full package path, or escape "/" uniquely.
    expect(collidedIds).toHaveLength(2);
    expect(
      document.relationships.filter(
        (rel) => rel.relatedSpdxElement === "SPDXRef-Package-node_modules-a-b",
      ),
    ).toHaveLength(2);
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

  it("certifies files outside the audited repository root with no containment check", () => {
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

    // DEFECT: declared paths are resolved with path.resolve(cwd, entry) and never contained, so
    // both escapes read as perfectly valid references: the missing-reference audit reports
    // nothing, and the bundle hashes and certifies a file that lives outside the audited root.
    // The same hole means a "../" runbook that lands on a real repo file is accepted, while a
    // "./"-prefixed sibling would be reported as missing purely because of its spelling.
    // Suggested fix: normalize each declared path at load time and reject absolute entries or
    // entries containing a ".." segment, next to the existing duplicate-id checks.
    expect(
      findMissingComplianceRegistryReferences(hostileRegistry, { cwd: root }),
    ).toEqual([]);

    const bundle = buildComplianceEvidenceBundle(hostileRegistry, {
      cwd: root,
      now: new Date("2026-06-01T00:00:00.000Z"),
    });

    const outsideContents = readFileSync(outsideFile);
    expect(bundle.controls[0]?.codePaths[0]).toEqual({
      path: escapingCodePath,
      exists: true,
      kind: "file",
      sha256: createHash("sha256").update(outsideContents).digest("hex"),
    });
    expect(bundle.controls[0]?.runbooks[0]?.exists).toBe(true);
    expect(bundle.summary.missingReferences).toBe(0);
    expect(bundle.controls[0]?.status).toBe("ready");
  });

  it("certifies a required evidence artifact that points at nothing", () => {
    const root = scratch();
    materializeControlTargets(root);

    const bundle = buildComplianceEvidenceBundle(
      registryDocument([
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
      ]) as never,
      {
        cwd: root,
        now: new Date("2026-06-01T00:00:00.000Z"),
        requireArtifacts: true,
      },
    );

    // DEFECT: an empty (or ".") artifact path resolves to the cwd, which always exists as a
    // directory, so a required evidence artifact that names no file at all is published as
    // satisfied and the strict `requireArtifacts` gate stays green. `findMissingCompliance…`
    // never looks at evidenceArtifacts either, so nothing else catches it.
    // Suggested fix: require a non-empty normalized relative path that resolves to an existing
    // *file* (kind === "file") for every declared evidence artifact.
    expect(
      bundle.controls[0]?.evidenceArtifacts.map((artifact) => artifact.exists),
    ).toEqual([true, true]);
    expect(bundle.summary.totalRequiredArtifacts).toBe(2);
    expect(bundle.summary.missingRequiredArtifacts).toBe(0);
    expect(bundle.controls[0]?.status).toBe("ready");

    // Contrast: a whitespace path (which a typo is just as likely to produce) is reported, so
    // the hole is specifically the empty/"." spelling rather than "any odd string".
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
  it("accepts a package-only exception as a wildcard for every advisory and severity", () => {
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

    const evaluation = evaluateRuntimeAuditReport(
      report,
      loadRuntimeAuditExceptionFile(wildcardPath),
      {
        minimumSeverity: "moderate",
        now: new Date("2026-06-01T00:00:00.000Z"),
      },
    );

    // DEFECT: loadRuntimeAuditExceptionFile does not require `advisoryId` or `severity`, and
    // findMatchingException treats their absence as "matches anything", so one config line
    // waives every current *and future* advisory on a package at every severity - scope
    // escalation through a file that is meant to be narrow and time-boxed. Note a critical
    // advisory was silenced by an exception that never mentions a severity at all.
    // Suggested fix: require advisoryId + severity in the loader, and refuse to match an
    // exception whose severity is lower than the finding's.
    expect(evaluation.summary).toMatchObject({
      findings: 3,
      allowedFindings: 3,
      blockingFindings: 0,
      activeExceptions: 3,
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
