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

