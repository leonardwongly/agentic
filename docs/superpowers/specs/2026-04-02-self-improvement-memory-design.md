# Self-Improvement Memory Design

Date: 2026-04-02
Status: Proposed
Scope: Slice 1 of the self-improving-agent rollout

## Quick understanding

This design introduces a dedicated, file-backed self-improvement memory subsystem for the Agentic repository. The subsystem stores semantic patterns, episodic experiences, and mutable working-memory snapshots under a separate operator-side directory so internal agent learning does not leak into the product-facing runtime store.

## Goals

1. Create a separate, local-only self-improvement store under `.agentic/self-improvement/`.
2. Define strict schemas for semantic, episodic, and working-memory records.
3. Expose a narrow repository API that owns validation, path safety, and atomic file writes.
4. Keep the first slice easy to inspect, test, and evolve.
5. Provide an implementation-ready task breakdown so the work can be executed in small, reviewable steps.

## Non-goals

1. Hook execution or shell integration.
2. Next.js routes or dashboard UI.
3. Automatic experience extraction from tasks or skill runs.
4. Skill-file mutation, evolution markers, or correction markers.
5. Postgres support.
6. Background jobs, compaction, or distributed locking.

## Boundaries

### Inputs

1. Internal hook events from future shell tooling.
2. Internal app or package calls that want to persist self-improvement state.
3. Error snapshots and skill outcomes from future integrations.

### Outputs

1. JSON files rooted under `.agentic/self-improvement/`.
2. Typed repository return values for later callers.

### Trust model

1. All event payloads are untrusted until schema-validated.
2. The base storage directory is trusted only after canonical resolution.
3. Callers are not allowed to choose arbitrary child paths.

## Failure modes

1. Invalid or oversized payloads.
2. Unknown fields or unsupported outcome values.
3. Partial writes or interrupted writes.
4. Corrupt JSON on disk.
5. Duplicate episodic record IDs.
6. Lost updates on concurrent semantic writes.
7. Unbounded disk growth from large text blobs or metadata.
8. Path traversal through slugs, IDs, or caller-supplied directories.

## Success criteria

1. Deterministic, human-readable on-disk layout.
2. Atomic writes for all mutable files.
3. Strict validation before write and after read.
4. Clear corruption failures instead of silent recovery.
5. A narrow repository API that future slices can reuse unchanged.
6. Fast, deterministic tests using temp directories.
7. An implementation sequence that a developer can execute without guessing missing coordination details.

## Delivery outcome

At the end of slice 1, the repository should have a dedicated self-improvement memory package that:

1. Creates and manages a separate `.agentic/self-improvement/` store.
2. Validates semantic, episodic, and working-memory payloads with strict schemas.
3. Performs safe, atomic file reads and writes.
4. Exposes a small repository interface for future hook scripts and app integrations.
5. Includes tests for correctness, abuse cases, corruption handling, and basic concurrency sanity.

The expected outcome is not just "files on disk." The expected outcome is a stable internal platform that later slices can depend on:

1. Hook tooling can write session and error snapshots without knowing file formats.
2. Pattern extraction code can append episodes and upsert patterns without touching raw JSON.
3. App integration can consume read-only views later without duplicating validation or path logic.

## Assumptions

1. The first implementation target is local development and test environments, not distributed deployment.
2. Node 20, TypeScript, Zod, and the repository’s current workspace conventions remain the active stack.
3. The self-improvement subsystem is internal infrastructure and should not be exposed through user-facing routes in slice 1.
4. Future writers will be low-volume and mostly local, so atomic file safety matters more than high-throughput concurrency.
5. The existing monorepo conventions should be followed unless there is a strong reason to diverge.

## Implementation overview

This implementation is structured as a dedicated internal package that acts as the single storage authority for self-improvement state.

At a high level, the approach is:

1. Define strict domain schemas for three memory classes:
   - semantic memory for reusable patterns
   - episodic memory for concrete experiences
   - working memory for mutable session snapshots
2. Encapsulate all filesystem access inside a repository package.
3. Use versioned JSON documents on disk for transparency and manual inspectability.
4. Protect the store with validation, path normalization, and atomic file writes.
5. Keep the public API narrow so later slices can build on stable interfaces instead of raw files.

This is deliberately not implemented as a generic storage layer. It is a domain-specific repository because:

1. semantic patterns and episodes have different invariants
2. working memory has replace-or-clear semantics instead of append semantics
3. each domain needs different error and duplicate handling

## Technologies, frameworks, and methodology

### Technologies

1. TypeScript
   Used for explicit typing, stable package exports, and clear repository contracts.
2. Zod
   Used for runtime validation of persisted documents and caller-provided payloads.
3. Node.js filesystem APIs
   Used for directory creation, file reads, and atomic temp-file writes plus rename.
4. Vitest
   Used for deterministic, isolated unit and repository tests.

### Methodology

1. Domain-first design
   The data model is defined before filesystem operations are implemented.
2. Repository pattern
   All callers interact through a repository boundary instead of touching files directly.
3. Fail-closed validation
   Invalid payloads and corrupt files are rejected explicitly rather than tolerated.
4. Incremental implementation
   The system is delivered in phases so correctness can be established before integration.
5. Minimal-safe design
   The design avoids generic abstractions and heavier backends until they are justified.

## Why this approach was chosen

The main design choice is to optimize for correctness, inspectability, and maintainability first.

This means:

1. JSON files are favored over a database in slice 1 because they are easy to inspect and diff.
2. One episode per file is favored over a shared log because it avoids merge-like write behavior for append operations.
3. A dedicated repository package is favored over extending the product runtime store because it preserves trust boundaries.
4. Strict schemas are favored over permissive parsing because internal learning systems become unreliable quickly if malformed state is allowed to accumulate.

The design intentionally accepts one trade-off:

1. semantic upserts are last-write-win in true concurrent write scenarios

That trade-off is acceptable in slice 1 because:

1. writes are expected to be low volume
2. the store is local-only
3. the repository API can later be preserved while the storage internals are upgraded

## Component structure

The implementation is split into a small number of focused components.

### 1. Domain schemas and types

Responsibility:

1. Define the exact structure of semantic patterns, episode records, and working-memory snapshots.
2. Enforce field constraints, enums, lengths, and versioning.

Why this component exists:

1. Every other component depends on a stable definition of valid data.
2. Validation rules should not be scattered across repository methods.

### 2. Path-resolution layer

Responsibility:

1. Resolve the base directory.
2. Derive paths for semantic, episodic, and working-memory files.
3. Sanitize filenames and guarantee all writes remain under the base directory.

Why this component exists:

1. Path handling is a security boundary.
2. Path logic is error-prone and should be centralized and tested once.

### 3. Atomic IO layer

Responsibility:

1. Read JSON text from disk.
2. Parse and validate file contents.
3. Write validated data through temp-file-plus-rename semantics.
4. Distinguish missing-file bootstrap behavior from corruption behavior.

Why this component exists:

1. Persistence safety is cross-cutting.
2. Atomicity and corruption handling must be consistent across all repository methods.

### 4. Repository layer

Responsibility:

1. Expose the public API callers use.
2. Coordinate validation, path resolution, IO, and domain-specific rules.
3. Implement upsert, append, list, and clear semantics.

Why this component exists:

1. This is the boundary that future hooks, app code, and extraction jobs will share.
2. Domain rules belong here, not in individual callers.

### 5. Test layer

Responsibility:

1. Verify schema correctness.
2. Verify repository behavior under normal and failure conditions.
3. Verify safety properties such as path confinement and duplicate rejection.

Why this component exists:

1. Persistence code fails in subtle ways.
2. The system should be proven through fast isolated tests before other slices depend on it.

## How the components interact

The interaction model is intentionally simple and directional.

1. A caller invokes a repository method.
2. The repository validates the caller payload using the domain schema.
3. The repository asks the path layer for the correct target path.
4. The repository calls the IO layer to read the current file, if needed.
5. The repository applies domain rules:
   - append-only for episodes
   - upsert for semantic patterns
   - replace-or-clear for working memory
6. The repository sends the final validated payload back to the IO layer for atomic persistence.
7. The repository returns typed results to the caller.

This keeps the dependency flow one-way:

1. schemas do not depend on repository code
2. path helpers do not know business logic
3. IO helpers do not know semantic versus episodic behavior
4. repository code coordinates the other components

## End-to-end workflow

The following describes how the implementation behaves from the moment a caller wants to persist information until that information is safely stored and later retrieved.

### Workflow A: Store a new episode

1. A future hook or retrospective job constructs an episode payload.
2. The caller invokes `appendEpisode(payload)`.
3. The repository validates the payload against `EpisodeRecordSchema`.
4. The repository derives the year directory from the episode timestamp.
5. The repository generates a safe filename from timestamp and a sanitized slug.
6. The repository checks whether an episode with the same ID already exists.
7. If a duplicate exists, the repository raises a conflict-style error and does not write.
8. If the write is valid, the repository serializes the episode to JSON.
9. The IO layer writes the JSON to a temp file in the target directory.
10. The temp file is renamed atomically into the final location.
11. The repository returns the validated persisted episode.

### Workflow B: Upsert a semantic pattern

1. A future extraction component produces or updates a semantic pattern.
2. The caller invokes `upsertSemanticPattern(pattern)`.
3. The repository validates the payload against `SemanticPatternSchema`.
4. The repository loads `semantic-patterns.json`.
5. The IO layer parses and validates the current file.
6. The repository merges by pattern ID.
7. If the ID already exists, `createdAt` is preserved and `updatedAt` is refreshed.
8. The full semantic file is validated again before write.
9. The IO layer writes the updated semantic file atomically.
10. The repository returns the normalized stored pattern.

### Workflow C: Update working memory

1. A future pre-start, error-capture, or session-end caller prepares a snapshot.
2. The caller invokes one of:
   - `writeCurrentSession(...)`
   - `writeLastError(...)`
   - `writeSessionEnd(...)`
3. The repository validates the payload or validates `null` for clear operations.
4. The path layer resolves the target working-memory file.
5. The IO layer writes a small versioned JSON snapshot atomically.
6. Later readers call `readWorkingMemory()` to load all three snapshots into one typed object.

## Data flow

This section describes the data movement through the system, including transformations and validation boundaries.

### Input data flow

1. External-to-package input starts as untrusted TypeScript objects from future callers.
2. The repository validates these objects immediately using Zod.
3. Invalid objects are rejected before any path or filesystem work happens.

### Persistence data flow

1. Validated in-memory objects are normalized into versioned JSON documents.
2. The repository passes these documents to atomic write helpers.
3. The documents are persisted to domain-specific locations under the base directory.

### Read data flow

1. Raw JSON is read from disk.
2. The JSON is parsed.
3. Parsed objects are validated against the expected schema.
4. Validated objects are returned to the caller as typed values.
5. Invalid file contents fail with an integrity error instead of being returned partially.

### Control flow versus data flow

Control flow:

1. caller -> repository -> path helper -> IO helper -> repository -> caller

Data flow:

1. caller payload -> schema validation -> normalized object -> JSON document -> atomic write -> disk

On read:

1. disk -> JSON text -> parsed object -> schema validation -> typed object -> caller

## Detailed implementation process

This is the detailed process a developer would follow to build the implementation end-to-end.

### Step 1: Create the package boundary

1. Add the new package directory.
2. Add its `package.json`.
3. Add the initial `src/index.ts`.
4. Ensure exports can be consumed by tests.

Purpose:

1. Establish a clean unit of ownership before adding logic.

### Step 2: Implement the domain model

1. Add enums and schemas for:
   - semantic patterns
   - episodes
   - current session
   - last error
   - session end
2. Add top-level versioned file schemas.
3. Add inferred TypeScript types from the schemas.

Purpose:

1. Make the contract explicit before implementing persistence.

### Step 3: Implement path safety

1. Add default base-dir resolution.
2. Add test-only override support.
3. Add path builders for all domain files.
4. Add filename sanitization for episodic records.
5. Add guards to ensure resulting paths stay rooted under the base dir.

Purpose:

1. Establish the filesystem trust boundary before any writes occur.

### Step 4: Implement atomic IO

1. Add JSON parse-and-validate helpers.
2. Add temp-file write helpers.
3. Add directory bootstrap support.
4. Add typed error wrapping for:
   - invalid payloads
   - corruption
   - duplicate writes
   - storage failures

Purpose:

1. Ensure persistence behavior is safe and consistent before domain operations are added.

### Step 5: Implement bootstrap

1. Add `seed()`.
2. Create the directory tree if missing.
3. Create empty semantic and working-memory files if missing.
4. Keep the operation idempotent.

Purpose:

1. Make the repository safe to call without requiring pre-provisioning.

### Step 6: Implement reads

1. Add semantic file reads.
2. Add single-pattern lookup.
3. Add episode lookup and listing.
4. Add unified working-memory reads.

Purpose:

1. Prove that the repository can interpret the on-disk model correctly before writes become more complex.

### Step 7: Implement writes

1. Add semantic upsert logic.
2. Add episodic append logic.
3. Add working-memory replace-or-clear logic.

Purpose:

1. Complete the repository’s write surface once the read and IO foundation is verified.

### Step 8: Add test coverage

1. Add schema tests.
2. Add repository tests.
3. Add corruption tests.
4. Add abuse-path tests.
5. Add concurrency sanity tests.

Purpose:

1. Prevent future slices from depending on a persistence layer that has not been stress-tested in realistic failure modes.

## Design decisions and rationale

### Decision 1: Separate store from runtime store

Chosen:

1. Separate `.agentic/self-improvement/` storage

Reason:

1. Preserves trust boundaries and avoids leaking internal learning state into product data.

Alternative sacrificed:

1. Simpler reuse of the existing runtime-store structure

Mitigation:

1. Reuse conventions, not the same file.

### Decision 2: Flat JSON over SQLite or journaled events

Chosen:

1. Flat JSON documents with one episode per file

Reason:

1. Lowest implementation complexity with strong inspectability.

Alternative sacrificed:

1. Better concurrency and replay semantics

Mitigation:

1. Keep the repository API stable so the backend can change later.

### Decision 3: Dedicated repository over generic document store

Chosen:

1. Domain-specific repository methods

Reason:

1. Each memory domain has different invariants and write behavior.

Alternative sacrificed:

1. A smaller-looking generic API

Mitigation:

1. Keep the dedicated API small and explicit.

### Decision 4: Strict validation and bounded fields

Chosen:

1. Fail-closed validation with field caps

Reason:

1. Internal persistence becomes unreliable if malformed or oversized records are allowed through.

Alternative sacrificed:

1. More permissive ingestion of loosely shaped data

Mitigation:

1. Allow future callers to normalize upstream before calling the repository.

## Potential challenges and limitations

### Challenge 1: Concurrent semantic writes

Issue:

1. Two writers can read the same semantic file and overwrite each other’s changes.

Impact:

1. Valid JSON is preserved, but one update can be lost.

Response:

1. Accept this in v1.
2. Keep semantic writes low volume.
3. Preserve the API so version checks or journaling can be added later.

### Challenge 2: Corrupt local files

Issue:

1. Manual edits or interrupted writes outside the repository can leave invalid JSON or invalid schema shapes.

Impact:

1. Reads could return bad state if corruption is not detected.

Response:

1. Validate after every read.
2. Raise integrity errors instead of silently recovering with partial data.

### Challenge 3: Path safety for episodic filenames

Issue:

1. Episode names and other text can include hostile or invalid path characters.

Impact:

1. Unsafe filenames or path traversal if not sanitized.

Response:

1. Never use caller-provided raw strings as paths.
2. Use repository-owned filename derivation and root confinement checks.

### Challenge 4: Unbounded growth

Issue:

1. Episodes and metadata can grow over time.

Impact:

1. Slower listing and larger semantic rewrites.

Response:

1. Bound payload sizes.
2. Use one-file-per-episode to localize write costs.
3. Keep a future migration path to stronger storage backends.

## Edge cases and error handling

### Edge case: store does not exist yet

Handling:

1. `seed()` creates the expected structure.
2. Missing required files are bootstrapped with empty versioned payloads.

### Edge case: caller passes malformed payload

Handling:

1. Reject at validation time.
2. Do not touch the filesystem.

### Edge case: duplicate episode ID

Handling:

1. Reject with a conflict-style repository error.
2. Preserve append-only behavior.

### Edge case: semantic file is missing

Handling:

1. Bootstrap an empty semantic file through `seed()` and continue.

### Edge case: semantic file is corrupt

Handling:

1. Throw an integrity error.
2. Do not overwrite the corrupt file automatically.

### Edge case: working-memory clear operation

Handling:

1. Persist a versioned file whose `value` is `null`.
2. Avoid ambiguous "missing file means cleared" behavior.

### Edge case: weird characters in content

Handling:

1. Content remains in JSON payload fields.
2. Filenames use sanitized derived values, not raw content.

### Edge case: base-dir override in tests

Handling:

1. Resolve the override canonically.
2. Keep all derived paths under that root.

### Edge case: interrupted write

Handling:

1. Temp file may remain.
2. Final file should remain intact because rename is atomic.
3. Future cleanup of temp files can be added later if needed.

## Storage boundary decision

The self-improvement store lives in a separate operator-side directory:

` .agentic/self-improvement/ `

This is intentionally separate from `.agentic/runtime-store.json` because self-improvement memory is system-internal state, not user-facing Agentic product memory.

### Why this was chosen

1. Preserves a clean trust boundary between product data and internal learning state.
2. Avoids coupling self-improvement evolution to the app’s runtime-store schema.
3. Reduces the risk of accidentally exposing internal state through existing APIs.
4. Keeps migration options open if the self-improvement subsystem later moves to a different backend.

### What was sacrificed

1. The existing file-store code cannot be reused as directly as it could with a shared store.
2. There is one more local persistence surface to manage.

### Mitigation

1. Mirror the repo’s existing persistence style: Zod validation, atomic rename writes, and explicit repository methods.
2. Keep the package small and isolated so later integration remains straightforward.

## Storage model decision

Version 1 uses flat JSON documents per domain:

1. `semantic-patterns.json` for reusable patterns.
2. One JSON file per episodic experience.
3. Small JSON snapshot files for working memory.

### Alternatives considered

#### Append-only journal plus snapshots

Pros:

1. Better replayability and audit history.
2. Stronger long-term recovery story.

Cons:

1. More moving parts than needed for slice 1.
2. Requires compaction, replay, and snapshot coordination logic.

#### Embedded SQLite

Pros:

1. Better transactional behavior.
2. Stronger concurrency properties.

Cons:

1. Heavier operational model.
2. Less readable by hand.
3. New dependency and migration overhead.

### Why flat JSON is recommended

1. Minimal moving parts.
2. Easy to inspect and repair manually.
3. Matches the repository’s current local-file conventions.
4. Supports atomic writes with temp-file-plus-rename.

## Directory layout

```text
.agentic/
  self-improvement/
    semantic-patterns.json
    episodic/
      2026/
        2026-04-02-debugger-empty-callback.json
    working/
      current-session.json
      last-error.json
      session-end.json
```

### Ownership by file

1. `semantic-patterns.json`
   Stores reusable, cross-episode abstractions keyed by ID.
2. `episodic/YYYY/*.json`
   Stores append-only, concrete experiences as one file per episode.
3. `working/current-session.json`
   Stores mutable current session state.
4. `working/last-error.json`
   Stores the latest captured error snapshot.
5. `working/session-end.json`
   Stores the final session status snapshot.

## Schema design

All top-level persisted files include `version: 1`.

### SemanticPatternsFile

```json
{
  "version": 1,
  "patterns": {
    "pat-2026-04-02-001": {
      "id": "pat-2026-04-02-001",
      "name": "Verify callbacks have implementations",
      "source": "implementation_review",
      "confidence": 0.95,
      "applications": 3,
      "createdAt": "2026-04-02T00:00:00.000Z",
      "updatedAt": "2026-04-02T00:00:00.000Z",
      "category": "debugging",
      "pattern": "Empty callbacks should be treated as a likely failure mode.",
      "problem": "No-op callbacks can make UI or workflow refresh paths silently fail.",
      "solution": {
        "summary": "Verify callback implementations before assuming upstream state is wrong."
      },
      "qualityRules": [
        "Inspect callback call sites and callback bodies together."
      ],
      "targetSkills": [
        "debugger"
      ],
      "relatedEpisodeIds": [
        "ep-2026-04-02-001"
      ]
    }
  }
}
```

Design constraints:

1. `patterns` is a record keyed by pattern ID for direct lookup and stable upserts.
2. `name` max length: 120.
3. `category` max length: 64.
4. `pattern` max length: 300.
5. `problem` max length: 1000.
6. `qualityRules` max items: 20.
7. `targetSkills` max items: 20.

### EpisodeRecord

```json
{
  "id": "ep-2026-04-02-001",
  "timestamp": "2026-04-02T00:00:00.000Z",
  "skill": "debugger",
  "task": "Investigate why the UI did not refresh after save.",
  "outcome": "success",
  "situation": "Data did not refresh after a form submission.",
  "rootCause": "The supplied callback existed but did not do any work.",
  "solution": "Implement the callback and test the refresh path end-to-end.",
  "lesson": "Verify callbacks are not empty functions before chasing state timing issues.",
  "relatedPatternId": "pat-2026-04-02-001",
  "userFeedback": {
    "rating": 8,
    "comments": "This was the exact issue."
  },
  "metadata": {
    "source": "manual-retrospective"
  }
}
```

Design constraints:

1. `outcome` enum: `success | partial | failure`.
2. `skill` max length: 80.
3. `task` max length: 300.
4. `situation`, `rootCause`, `solution`, `lesson` max length: 2000 each.
5. `userFeedback` is optional.
6. `metadata` must be JSON-safe and depth-bounded.

### WorkingMemoryFile

Each working-memory file is a small versioned snapshot with one nullable payload.

Example `current-session.json`:

```json
{
  "version": 1,
  "value": {
    "sessionId": "sess-2026-04-02-001",
    "skill": "self-improving-agent",
    "startedAt": "2026-04-02T00:00:00.000Z",
    "context": "Start self-improving-agent",
    "activeTask": "Design memory engine",
    "status": "running"
  }
}
```

Example `last-error.json`:

```json
{
  "version": 1,
  "value": {
    "capturedAt": "2026-04-02T00:00:00.000Z",
    "skill": "debugger",
    "tool": "bash",
    "message": "Command failed",
    "exitCode": 1,
    "inputSummary": "npm test",
    "outputSummary": "One test failed"
  }
}
```

Example `session-end.json`:

```json
{
  "version": 1,
  "value": {
    "sessionId": "sess-2026-04-02-001",
    "endedAt": "2026-04-02T01:00:00.000Z",
    "status": "completed",
    "summary": "Core design approved by user."
  }
}
```

## Repository design

### Package

New package:

`packages/self-improvement-memory/`

Files:

1. `packages/self-improvement-memory/package.json`
2. `packages/self-improvement-memory/src/index.ts`

### Public API

```ts
createSelfImprovementRepository(options?)
seed()
readSemanticPatterns()
getSemanticPattern(id)
upsertSemanticPattern(pattern)
appendEpisode(episode)
getEpisode(id, year?)
listEpisodes(filters?)
readWorkingMemory()
writeCurrentSession(sessionOrNull)
writeLastError(errorOrNull)
writeSessionEnd(snapshotOrNull)
clearWorkingMemory()
```

### API behavior

1. `createSelfImprovementRepository(options?)`
   Creates a repository bound to a base directory.
2. `seed()`
   Creates the directory tree and empty top-level files if they do not exist.
3. `readSemanticPatterns()`
   Returns the validated semantic pattern file.
4. `getSemanticPattern(id)`
   Returns the pattern or `null`.
5. `upsertSemanticPattern(pattern)`
   Replaces by ID, preserves `createdAt` on update, and refreshes `updatedAt`.
6. `appendEpisode(episode)`
   Persists one file per episode and rejects duplicate IDs.
7. `getEpisode(id, year?)`
   Loads a single episode by ID, optionally using a year hint.
8. `listEpisodes(filters?)`
   Lists validated episodes sorted by most recent first, with simple filters.
9. `readWorkingMemory()`
   Loads the three working-memory snapshots into one typed object.
10. `writeCurrentSession(sessionOrNull)`
    Replaces or clears current session state.
11. `writeLastError(errorOrNull)`
    Replaces or clears the latest error snapshot.
12. `writeSessionEnd(snapshotOrNull)`
    Replaces or clears the session-end snapshot.
13. `clearWorkingMemory()`
    Resets all working-memory snapshots to null values.

### Internal repository responsibilities

1. Canonical base-dir resolution.
2. Safe path derivation under the fixed base directory.
3. Temp-file-plus-rename writes.
4. Validation before write and after read.
5. Typed repository errors for invalid payloads, duplicate episodes, corruption, and storage failures.

### Behavior that remains out of scope

1. Hook execution.
2. File locking.
3. Postgres parity.
4. Background compaction or migration jobs.

## Workflow coordination

This slice introduces a new internal workflow with clear boundaries between callers and storage code.

### Coordination model

1. Callers express intent.
   Examples:
   - "append this episode"
   - "upsert this semantic pattern"
   - "record the current session"
2. The repository validates and normalizes inputs.
3. The repository resolves safe paths under the fixed base directory.
4. The repository performs atomic writes or validated reads.
5. The repository returns typed results or typed failures.

### Why this coordination matters

Without a central coordination layer, future hook scripts, app code, and retrospective tooling would each end up:

1. Re-implementing validation.
2. Re-implementing path handling.
3. Writing incompatible JSON.
4. Creating different corruption and race-condition behaviors.

This design prevents that by making the repository the only owner of:

1. File naming.
2. Directory creation.
3. Atomic write semantics.
4. Version handling.
5. Corruption detection.

### Example workflow: append an episode

1. A future hook or internal caller constructs an episode payload.
2. The caller invokes `appendEpisode(payload)`.
3. The repository validates the payload against `EpisodeRecordSchema`.
4. The repository derives the year directory from `timestamp`.
5. The repository creates the directory if needed.
6. The repository derives a safe filename from timestamp and a sanitized slug.
7. The repository checks whether the episode ID already exists.
8. The repository writes a temp file and renames it into place.
9. The repository returns the persisted episode.

### Example workflow: update current session

1. A future pre-start hook captures session context.
2. The caller invokes `writeCurrentSession(session)`.
3. The repository validates the payload.
4. The repository writes `working/current-session.json` atomically.
5. Later callers can read that snapshot using `readWorkingMemory()`.

### Example workflow: evolve a semantic pattern

1. A later extraction component decides a reusable pattern should be created or reinforced.
2. The caller invokes `upsertSemanticPattern(pattern)`.
3. The repository reads and validates the current semantic file.
4. The repository preserves `createdAt` if the pattern already exists.
5. The repository updates `updatedAt` and writes the full file atomically.
6. The repository returns the normalized stored pattern.

## Write and corruption semantics

### Reads

1. Validate every file after parsing.
2. Missing top-level files are recreated through `seed()`.
3. Corrupt JSON raises an integrity error that identifies the file path.

### Writes

1. Validate input first.
2. Ensure parent directories exist.
3. Write to a temp file in the same directory.
4. Rename temp file into place atomically.

### Duplicate rules

1. Episodes are append-only and reject duplicate IDs.
2. Semantic patterns are upserted by ID.
3. Working-memory snapshots are replace-or-clear.

### Concurrency

1. Torn writes are prevented through atomic rename.
2. Concurrent semantic updates can still be last-write-win.

This is an explicit v1 trade-off.

Mitigation:

1. Keep semantic writes low volume.
2. Preserve the repository API so internals can later move to journaling or SQLite.

## Security checklist

Protected against:

1. Path traversal through sanitized, repository-owned file paths.
2. Unknown fields through strict schema validation.
3. Oversized text blobs through explicit length caps.
4. Torn writes through temp-file-plus-rename.
5. Silent episode overwrite through duplicate ID rejection.

Remaining risks:

1. Concurrent semantic updates can overwrite each other.
2. Rich metadata could still drift into low-signal storage unless bounded tightly.

## Performance notes

1. Episodic writes are O(1) per append because each episode gets its own file.
2. Semantic upserts are O(n) in number of patterns because the full document is rewritten.
3. Working-memory operations are effectively O(1) because files remain small.
4. Episode listing is O(n log n) over matching episode files due to timestamp sorting.

Likely bottleneck:

1. Semantic-pattern growth, not episodic writes.

Measurement plan:

1. Track semantic upsert latency as pattern count grows.
2. Track episode listing latency as year directories accumulate files.

## Task breakdown

This section is the execution-oriented breakdown for implementing slice 1. Each task is designed to be small enough for review and to keep behavior changes isolated.

### Phase 1: Package scaffold

Task 1.1: Create workspace package

Sub-tasks:

1. Add `packages/self-improvement-memory/package.json`.
2. Add `packages/self-improvement-memory/src/index.ts`.
3. Align the package naming and export style with the existing monorepo packages.
4. Ensure the root workspace can resolve the new package in tests.

Why:

1. This isolates self-improvement memory from product-domain memory.
2. It keeps the new subsystem importable without modifying unrelated app code.

Task 1.2: Define public package boundary

Sub-tasks:

1. Decide which types and schemas are exported publicly.
2. Keep helper functions internal unless callers need them.
3. Export only the repository factory and domain types needed by future slices.

Why:

1. A narrow public API makes later refactors safer.
2. Internal path and IO helpers should remain private.

### Phase 2: Schema and type system

Task 2.1: Define top-level file schemas

Sub-tasks:

1. Add schema for `SemanticPatternsFile`.
2. Add schema for versioned working-memory snapshot files.
3. Define shared helper schemas for bounded JSON metadata.

Why:

1. Top-level file schemas define the persistent contract.
2. Versioning belongs in the file schemas, not only the repository logic.

Task 2.2: Define record-level schemas

Sub-tasks:

1. Add `SemanticPatternSchema`.
2. Add `EpisodeRecordSchema`.
3. Add schemas for current-session, last-error, and session-end payloads.
4. Add enums for episode outcome and working-session status if needed.

Why:

1. Record schemas are reused across reads, writes, and tests.
2. Tight validation closes off malformed input early.

Task 2.3: Define limits and invariants

Sub-tasks:

1. Add max lengths to text fields.
2. Add max item counts to arrays.
3. Add `.strict()` where unknown fields should fail.
4. Bound metadata depth and allowed JSON value types.

Why:

1. This is the main defense against accidental or hostile store growth.
2. These limits turn vague quality concerns into enforceable rules.

### Phase 3: Internal filesystem primitives

Task 3.1: Base-dir resolution

Sub-tasks:

1. Define the default base dir as `.agentic/self-improvement`.
2. Allow an override for tests and future tooling.
3. Resolve the final path canonically.
4. Ensure repository-owned paths always stay under the base dir.

Why:

1. This is the main path-traversal boundary.
2. All later file operations depend on it.

Task 3.2: Safe path helpers

Sub-tasks:

1. Create helpers for semantic, working, and episodic file paths.
2. Sanitize filename slugs.
3. Derive year directories from episode timestamps.
4. Add guardrails so helper output cannot escape the base dir.

Why:

1. Path logic should be written once and tested once.
2. Episodic naming is where path bugs are most likely.

Task 3.3: Atomic JSON IO helpers

Sub-tasks:

1. Create a helper to read and validate JSON.
2. Create a helper to write temp files and rename them atomically.
3. Ensure parent directories exist before writes.
4. Standardize error wrapping for corruption vs storage failures.

Why:

1. These helpers are cross-cutting concerns used by every repository method.
2. If they are wrong, every call site is wrong.

### Phase 4: Bootstrap and reads

Task 4.1: Implement `seed()`

Sub-tasks:

1. Create the base directory.
2. Create the `episodic/` and `working/` directories.
3. Create an empty `semantic-patterns.json` if missing.
4. Create empty versioned working-memory files if missing.
5. Keep the operation idempotent.

Why:

1. Callers should not need to care whether the store exists yet.
2. Tests need deterministic bootstrap behavior.

Task 4.2: Implement read methods

Sub-tasks:

1. Implement `readSemanticPatterns()`.
2. Implement `getSemanticPattern(id)`.
3. Implement `readWorkingMemory()`.
4. Implement `getEpisode(id, year?)`.
5. Implement `listEpisodes(filters?)`.

Why:

1. Read paths establish how the package exposes validated state.
2. They also prove the schemas and path helpers work together.

### Phase 5: Write methods

Task 5.1: Implement semantic upsert

Sub-tasks:

1. Load and validate the current semantic file.
2. Merge or replace by ID.
3. Preserve `createdAt` on update.
4. Refresh `updatedAt`.
5. Atomically rewrite the semantic file.

Why:

1. Semantic patterns are the only shared-document write path in v1.
2. This is the place where last-write-win behavior must be explicit.

Task 5.2: Implement episodic append

Sub-tasks:

1. Validate the episode.
2. Derive the year directory and safe filename.
3. Check for duplicate IDs.
4. Write the episode as a new file.
5. Return the persisted record.

Why:

1. Episode append is the primary ingestion path for concrete experiences.
2. It should behave predictably and fail closed on duplicates.

Task 5.3: Implement working-memory writes

Sub-tasks:

1. Implement `writeCurrentSession(sessionOrNull)`.
2. Implement `writeLastError(errorOrNull)`.
3. Implement `writeSessionEnd(snapshotOrNull)`.
4. Implement `clearWorkingMemory()`.

Why:

1. Working memory is mutable by design.
2. Each snapshot needs a clear replace-or-clear behavior.

### Phase 6: Verification

Task 6.1: Schema tests

Sub-tasks:

1. Add valid-case tests.
2. Add unknown-field rejection tests.
3. Add oversize rejection tests.
4. Add invalid-enum tests.

Task 6.2: Repository tests

Sub-tasks:

1. Add bootstrap tests for `seed()`.
2. Add semantic read/write tests.
3. Add episodic append and list tests.
4. Add working-memory write/clear tests.
5. Add corruption-handling tests.

Task 6.3: Abuse and sanity tests

Sub-tasks:

1. Add path-safety tests.
2. Add duplicate-episode rejection tests.
3. Add concurrent semantic write sanity tests.
4. Add basic linear-growth sanity tests for episode append/list.

Why:

1. The subsystem is mostly persistence logic.
2. Persistence logic without abuse-path tests is not production-ready even for local-only use.

## Implementation workflow

This section describes how a developer should execute the work, not just what should exist at the end.

### Recommended execution sequence

1. Create the package scaffold.
2. Add schemas and types.
3. Add internal path helpers.
4. Add atomic IO helpers.
5. Implement `seed()`.
6. Implement read methods.
7. Implement semantic upsert.
8. Implement episodic append and list methods.
9. Implement working-memory writes and clears.
10. Add and run tests continuously after each step.

### Recommended review checkpoints

Checkpoint 1: package and schema review

Verify:

1. The exported surface is not too broad.
2. Field constraints are concrete and justified.
3. Unknown fields are rejected where intended.

Checkpoint 2: filesystem helper review

Verify:

1. Base-dir handling is safe.
2. Atomic writes are actually atomic.
3. Error wrapping separates corruption from ordinary missing-file cases.

Checkpoint 3: repository behavior review

Verify:

1. Duplicate behavior is explicit.
2. `createdAt` preservation works.
3. Working-memory clear semantics are unambiguous.

Checkpoint 4: test review

Verify:

1. Happy-path coverage exists.
2. Abuse-path coverage exists.
3. Tests use temp directories and remain deterministic.

## How this achieves later slices

This slice is intentionally foundational. It enables later work as follows:

1. Hook tooling slice:
   - writes into working memory and episodic memory through repository calls
   - does not need to know file formats
2. Agentic app integration slice:
   - can add read-only inspection surfaces over validated data
   - does not need raw filesystem logic in route handlers
3. Skill/package hardening slice:
   - can convert completed work into episodes and patterns
   - can record evolution sources using stable IDs

Without slice 1, the later slices would either:

1. Duplicate file logic in multiple places.
2. Create incompatible schemas.
3. Increase corruption and path-safety risk.

## Test plan

### Schema tests

1. Accept valid semantic, episodic, and working-memory payloads.
2. Reject unknown fields.
3. Reject invalid enums.
4. Reject oversized strings and oversized metadata.

### Repository bootstrap tests

1. `seed()` creates the expected directory tree.
2. `seed()` is idempotent.
3. Missing top-level files are recreated safely.

### Semantic memory tests

1. First upsert creates the semantic file.
2. Repeated upsert preserves `createdAt`.
3. Repeated upsert updates `updatedAt`.
4. Read-after-write returns validated content.

### Episodic memory tests

1. Appending an episode creates the year directory and file.
2. Duplicate IDs are rejected.
3. Listing is most-recent-first.
4. Filtering by year, skill, and outcome works.
5. Weird characters in content do not break path safety.

### Working memory tests

1. Write and read current session.
2. Write and read last error.
3. Write and read session end.
4. Clear each snapshot by writing `null`.
5. Clear all snapshots with `clearWorkingMemory()`.

### Abuse and error-path tests

1. Corrupt JSON raises an integrity error.
2. Invalid payloads fail before any write occurs.
3. Base-dir override stays rooted correctly.
4. Sanitized filenames cannot escape the base directory.

### Concurrency and performance sanity tests

1. Concurrent semantic writes do not leave malformed JSON.
2. Appending many episodes remains linear enough for local use.

## Implementation order

1. Add the new workspace package scaffold.
2. Implement schemas and types first.
3. Add internal path-resolution and atomic-write helpers.
4. Implement `seed()` and read logic.
5. Implement semantic upsert and lookup.
6. Implement episodic append, lookup, and list.
7. Implement working-memory writes and clear operations.
8. Add tests alongside each step.

## Definition of done

1. The new package exists and is importable in the workspace.
2. Semantic, episodic, and working-memory schemas are implemented.
3. Repository methods are implemented.
4. File writes are atomic.
5. Tests cover happy path, edge cases, abuse cases, and corruption handling.
6. No unrelated app behavior changes are bundled into this slice.

## Open items

1. The spec-review subagent step from the brainstorming workflow is blocked in this session because sub-agent spawning is not authorized here.
2. If that authorization becomes available later, run a dedicated spec review pass against this file before implementation.
3. A future implementation-plan document should map these phases to exact files and test commands before coding begins.
