# Self-Improvement Memory Implementation Plan

Date: 2026-04-02
Status: Ready for implementation
Related spec: `/Users/leonardwongly/Developer/Agentic/docs/superpowers/specs/2026-04-02-self-improvement-memory-design.md`
Scope: Slice 1 only

## Quick understanding

This plan translates the approved self-improvement memory design into an implementation sequence that can be executed in the current Agentic monorepo. The goal is to build a dedicated internal package for semantic, episodic, and working memory with safe file-backed persistence, strict validation, atomic writes, and a test suite strong enough that later slices can depend on it without re-litigating storage behavior.

## Assumptions

1. The implementation target is the current Node 20 and TypeScript monorepo.
2. The package will be file-backed only in this slice.
3. No user-facing routes or UI changes are part of this plan.
4. Existing unrelated worktree changes must remain untouched.
5. The `writing-plans` skill is unavailable in this session, so this document serves as the implementation plan artifact.

## Success criteria

1. A new workspace package exists at `packages/self-improvement-memory/`.
2. The package exports strict schemas, types, and a repository factory.
3. The repository stores data under `.agentic/self-improvement/` by default.
4. All reads validate persisted JSON before returning typed values.
5. All writes use temp-file-plus-rename semantics.
6. The test suite covers happy paths, edge cases, abuse cases, corruption, and concurrency sanity.
7. No unrelated application files are modified during implementation.

## Implementation approach

The implementation will be delivered in six phases:

1. Package scaffold and exports
2. Domain schemas and types
3. Internal filesystem and atomic IO helpers
4. Repository bootstrap and read operations
5. Repository write operations
6. Verification and cleanup

The phases are intentionally ordered so each later phase depends on verified work from the earlier phase. This keeps the implementation reviewable and minimizes the risk of debugging storage behavior after multiple layers have already been stacked on top.

## Files to create or modify

### New package files

1. `/Users/leonardwongly/Developer/Agentic/packages/self-improvement-memory/package.json`
2. `/Users/leonardwongly/Developer/Agentic/packages/self-improvement-memory/src/index.ts`

### Test files

1. `/Users/leonardwongly/Developer/Agentic/tests/self-improvement-memory.test.ts`

### Optional supporting split, only if `src/index.ts` becomes too large

1. `/Users/leonardwongly/Developer/Agentic/packages/self-improvement-memory/src/schemas.ts`
2. `/Users/leonardwongly/Developer/Agentic/packages/self-improvement-memory/src/paths.ts`
3. `/Users/leonardwongly/Developer/Agentic/packages/self-improvement-memory/src/io.ts`
4. `/Users/leonardwongly/Developer/Agentic/packages/self-improvement-memory/src/errors.ts`

The preferred starting point is a single `src/index.ts` file. If the implementation becomes hard to read, split by responsibility without changing the public API.

## Phase 1: Package scaffold and exports

### Objective

Create a new workspace package that matches the monorepo’s current conventions and is importable by tests.

### Tasks

Task 1.1: Add package manifest

Sub-tasks:

1. Mirror the structure used by other packages such as `packages/memory/package.json`.
2. Set the package name to something consistent, such as `@agentic/self-improvement-memory`.
3. Export `src/index.ts` as the package entrypoint.

Task 1.2: Add package entrypoint

Sub-tasks:

1. Create `src/index.ts`.
2. Add placeholder exports for schemas, types, and repository factory.
3. Keep internal helper exports private by default.

Task 1.3: Verify workspace resolution

Sub-tasks:

1. Confirm tests can import the new package name.
2. Avoid unnecessary root `package.json` changes unless resolution actually fails.

### Acceptance criteria

1. The new package is resolved by Vitest imports.
2. The package has a clear public boundary.

### Risks

1. Over-exporting internal helpers.
2. Creating a package that does not match workspace conventions.

### Mitigation

1. Follow the existing package manifest pattern.
2. Export only the repository factory, schemas, and public types.

## Phase 2: Domain schemas and types

### Objective

Define the self-improvement memory contract before any filesystem code is written.

### Tasks

Task 2.1: Define shared primitive schemas

Sub-tasks:

1. Add bounded string helpers if useful.
2. Add a JSON-safe metadata schema.
3. Add helper schemas for timestamps, version fields, and nullable snapshot wrappers.

Task 2.2: Define semantic pattern schemas

Sub-tasks:

1. Add `SemanticPatternSchema`.
2. Add `SemanticPatternsFileSchema`.
3. Enforce bounded array sizes and text sizes.
4. Keep the top-level `patterns` container keyed by ID.

Task 2.3: Define episode schemas

Sub-tasks:

1. Add `EpisodeOutcomeSchema`.
2. Add `EpisodeRecordSchema`.
3. Add `UserFeedbackSchema`.
4. Ensure the record is strict and bounded.

Task 2.4: Define working-memory schemas

Sub-tasks:

1. Add `CurrentSessionSchema`.
2. Add `LastErrorSchema`.
3. Add `SessionEndSchema`.
4. Add versioned file schemas for each snapshot file.

Task 2.5: Export inferred types

Sub-tasks:

1. Export public TypeScript types inferred from the schemas.
2. Avoid duplicate handwritten interfaces unless they add real value.

### Acceptance criteria

1. All three memory domains are strictly modeled.
2. Unknown fields fail where intended.
3. Field bounds are explicit and documented in code.

### Risks

1. Letting metadata become too permissive.
2. Putting versioning only in comments rather than the schema.

### Mitigation

1. Keep metadata JSON-safe and bounded.
2. Include `version: 1` directly in the file schemas.

## Phase 3: Filesystem, path, and IO primitives

### Objective

Create the internal infrastructure that safely maps domain records to files and persists them atomically.

### Tasks

Task 3.1: Resolve base directory

Sub-tasks:

1. Implement a default base path rooted at `.agentic/self-improvement`.
2. Allow a test override path through the repository factory.
3. Resolve the path to an absolute canonical form.

Task 3.2: Build safe path helpers

Sub-tasks:

1. Add helpers for:
   - semantic file path
   - working directory path
   - current-session path
   - last-error path
   - session-end path
   - episodic year directory path
   - episode file path
2. Sanitize episode filename slugs.
3. Add a root-confinement check so derived paths cannot escape the base dir.

Task 3.3: Add read helpers

Sub-tasks:

1. Read UTF-8 JSON text.
2. Parse JSON.
3. Validate against a supplied schema.
4. Distinguish missing-file behavior from corruption behavior.

Task 3.4: Add write helpers

Sub-tasks:

1. Ensure parent directories exist.
2. Serialize validated values with readable formatting.
3. Write to a temp file in the target directory.
4. Rename atomically into place.

Task 3.5: Add repository error types

Sub-tasks:

1. Define a validation-style error for invalid caller payloads.
2. Define an integrity error for corrupt on-disk content.
3. Define a conflict error for duplicate episode IDs.
4. Define a storage error for unexpected filesystem failures.

### Acceptance criteria

1. Every repository method can rely on a single set of safe path and IO helpers.
2. Temp-file writes do not expose torn final files.
3. Corrupt JSON is surfaced clearly.

### Risks

1. Path traversal bugs in episodic filenames.
2. Misclassifying corruption as a missing file.

### Mitigation

1. Never use raw caller strings as path segments.
2. Validate file shapes after every read.

## Phase 4: Bootstrap and read operations

### Objective

Make the repository safe to initialize and safe to read from before write complexity is added.

### Tasks

Task 4.1: Implement repository factory

Sub-tasks:

1. Add `createSelfImprovementRepository(options?)`.
2. Bind the repository to the resolved base directory.
3. Close over internal helpers rather than exposing them publicly.

Task 4.2: Implement `seed()`

Sub-tasks:

1. Create the base directory.
2. Create `episodic/` and `working/`.
3. Create default `semantic-patterns.json` if missing.
4. Create default versioned working-memory files with `value: null` if missing.
5. Keep the method idempotent.

Task 4.3: Implement semantic reads

Sub-tasks:

1. Add `readSemanticPatterns()`.
2. Add `getSemanticPattern(id)`.

Task 4.4: Implement working-memory reads

Sub-tasks:

1. Add `readWorkingMemory()`.
2. Load all three working-memory files and return one typed object.

Task 4.5: Implement episodic reads

Sub-tasks:

1. Add `getEpisode(id, year?)`.
2. Add `listEpisodes(filters?)`.
3. Sort episode results by descending timestamp.

### Acceptance criteria

1. The repository can create an empty store from nothing.
2. The repository can read all domains without direct file access from callers.

### Risks

1. `getEpisode(id)` becoming expensive if year is omitted.
2. Overcomplicating read paths before real scale exists.

### Mitigation

1. Accept lightweight scanning in v1.
2. Keep filter support minimal and predictable.

## Phase 5: Write operations

### Objective

Complete the repository behavior for semantic upsert, episodic append, and working-memory replacement.

### Tasks

Task 5.1: Implement semantic upsert

Sub-tasks:

1. Validate the incoming pattern.
2. Read the current semantic file.
3. Merge by ID.
4. Preserve `createdAt` if the pattern already exists.
5. Refresh `updatedAt`.
6. Validate the final top-level semantic file.
7. Persist atomically.

Task 5.2: Implement episodic append

Sub-tasks:

1. Validate the incoming episode.
2. Derive year and safe filename.
3. Check for duplicate ID.
4. Persist as a new file atomically.
5. Return the stored episode.

Task 5.3: Implement working-memory writes

Sub-tasks:

1. Add `writeCurrentSession(sessionOrNull)`.
2. Add `writeLastError(errorOrNull)`.
3. Add `writeSessionEnd(snapshotOrNull)`.
4. Persist `null` values explicitly inside versioned files rather than deleting files.

Task 5.4: Implement working-memory clearing

Sub-tasks:

1. Add `clearWorkingMemory()`.
2. Write `value: null` snapshots for all three working-memory files.

### Acceptance criteria

1. Semantic patterns upsert deterministically.
2. Episodes remain append-only.
3. Working memory uses replace-or-clear semantics.

### Risks

1. Lost semantic updates under true concurrent writes.
2. Ambiguous clear semantics if files are deleted instead of nulled.

### Mitigation

1. Accept last-write-win in v1 and document it.
2. Represent clear state explicitly with `value: null`.

## Phase 6: Verification and cleanup

### Objective

Prove the package works under normal, abusive, and failure scenarios and keep the final code readable.

### Tasks

Task 6.1: Add schema validation tests

Sub-tasks:

1. Valid semantic payload.
2. Valid episode payload.
3. Valid working-memory payloads.
4. Unknown-field rejection.
5. Invalid-enum rejection.
6. Oversize rejection.

Task 6.2: Add repository bootstrap tests

Sub-tasks:

1. Empty temp directory bootstrap.
2. Idempotent `seed()`.
3. Missing top-level file recreation.

Task 6.3: Add semantic repository tests

Sub-tasks:

1. First write creates store.
2. Repeated upsert preserves `createdAt`.
3. `updatedAt` changes on update.
4. Read-after-write returns valid data.

Task 6.4: Add episodic repository tests

Sub-tasks:

1. Append creates year directory and file.
2. Duplicate ID rejection.
3. Sorting by descending timestamp.
4. Filtering by year, skill, and outcome.

Task 6.5: Add working-memory tests

Sub-tasks:

1. Write and read current session.
2. Write and read last error.
3. Write and read session end.
4. Clear one snapshot with `null`.
5. Clear all snapshots.

Task 6.6: Add abuse and failure tests

Sub-tasks:

1. Corrupt semantic JSON.
2. Corrupt episodic JSON.
3. Corrupt working-memory JSON.
4. Path confinement checks.
5. Weird characters in content and slug generation.

Task 6.7: Add concurrency and performance sanity tests

Sub-tasks:

1. Simultaneous semantic writes should not leave malformed JSON.
2. Appending many episodes should not show obvious quadratic behavior.

### Acceptance criteria

1. The repository is covered by fast isolated tests using temp directories.
2. The most important failure modes are codified in tests.

## Component interaction map

The final implementation should follow this interaction sequence:

1. Caller constructs an input object.
2. Caller invokes a repository method.
3. Repository validates input using Zod schemas.
4. Repository derives safe file paths via internal path helpers.
5. Repository reads existing JSON through IO helpers if needed.
6. Repository applies domain-specific logic:
   - semantic: merge/upsert
   - episodic: append with duplicate rejection
   - working: replace or clear
7. Repository writes final JSON atomically.
8. Repository returns validated typed output or a typed repository error.

This interaction model must remain stable so later slices can layer on top without bypassing storage rules.

## End-to-end data flow

### Write flow

1. Future caller prepares domain payload.
2. Repository validates payload.
3. Repository normalizes and enriches write state where needed.
4. Repository generates or resolves the target path.
5. JSON is serialized.
6. Temp file is written.
7. Temp file is renamed into place.
8. Caller receives the stored typed record.

### Read flow

1. Caller invokes repository read method.
2. Repository resolves the target path.
3. JSON is read from disk.
4. JSON is parsed and validated.
5. Repository returns typed data or raises integrity error.

## Coordination with later slices

This plan is intentionally a dependency for later work.

1. Hook tooling slice
   - will call `writeCurrentSession`, `writeLastError`, `writeSessionEnd`, and `appendEpisode`
   - will not implement raw file IO
2. Pattern extraction slice
   - will call `appendEpisode` and `upsertSemanticPattern`
   - will not define new storage schemas
3. App integration slice
   - will consume repository read methods
   - will not read JSON files directly in route handlers

The key rule is that later slices coordinate through the repository API, not around it.

## Commands to run during implementation

### Focused test loop

```bash
npx vitest run tests/self-improvement-memory.test.ts
```

### Full suite before completion

```bash
npm test
```

## Expected implementation workflow

1. Create package files.
2. Add schemas and types.
3. Add internal helper functions.
4. Implement repository factory and `seed()`.
5. Implement reads.
6. Implement writes.
7. Add tests incrementally.
8. Run focused tests during development.
9. Run the full suite before finishing.

At each step, the implementation should remain in a working state. Avoid writing the whole package first and only testing at the end.

## Potential challenges and responses

### Challenge: path safety

Response:

1. Centralize path derivation.
2. Add root-confinement assertions.
3. Add explicit path-safety tests.

### Challenge: malformed persisted JSON

Response:

1. Validate every read.
2. Throw integrity errors instead of silently repairing data.

### Challenge: duplicate episode writes

Response:

1. Reject duplicates explicitly.
2. Preserve append-only semantics.

### Challenge: concurrent semantic updates

Response:

1. Accept last-write-win in v1.
2. Ensure no malformed final JSON.
3. Preserve API stability for a stronger future backend.

## Definition of done

1. New package exists and compiles.
2. Repository API is implemented.
3. Default `.agentic/self-improvement/` layout is supported.
4. Atomic writes are in place.
5. Tests cover happy path, edge cases, abuse cases, corruption, and sanity concurrency.
6. No user-facing routes or UI changes are bundled.
7. No unrelated files are changed as part of the implementation.

## Out of scope

1. Hook shell scripts
2. Session loggers
3. Automatic pattern extraction algorithms
4. Skill-file mutation
5. Next.js API routes
6. Postgres support
7. Background compaction

## Next action

Implement the package in the order described above, starting with:

1. `packages/self-improvement-memory/package.json` and `src/index.ts`
2. schema definitions
3. the repository factory and bootstrap behavior
