# Learning Memory Flywheel

The learning memory flywheel turns completed goals, approval decisions, execution results, replay outcomes, and operator feedback into bounded self-improvement episodes. These episodes are advisory inputs for recommendations and policy replay gates; they are not direct authorization to execute work.

## Capture Contract

- Goal and execution capture writes normal `MemoryRecord` entries plus self-improvement `EpisodeRecord` files.
- Every new episode carries `provenance.ownerUserId`, `provenance.workspaceId`, recommendation keys, linked memory IDs, action-log IDs, and retention/redaction metadata.
- Recommendation feedback writes a goal action log and a separate feedback episode so accepted, edited, rejected, and ignored recommendations affect future replay scoring.
- Episode IDs are deterministic for goal/execution capture and action-log scoped for feedback capture, which keeps retries idempotent while preserving distinct operator feedback events.

## Privacy And Retention

- Public recommendation routes call `listEpisodes({ ownerUserId })`; cross-owner episodes are excluded before scoring.
- Expired episodes are excluded by default. Diagnostic callers may opt into expired records only through repository-level `includeExpired` filters in tests or internal tooling.
- Captured text is boundary-redacted before learning storage. Current automatic rules redact email addresses and secret-like `token`, `secret`, `password`, and `api_key` assignments.
- Episodes record the redaction rules and fields that were affected. Raw execution payloads and connector secrets must not be copied into episode metadata.
- Default outcome retention is review after 90 days and expiry after 365 days. Feedback episodes use the same duration under the `learning-feedback-365d` policy.

## Recommendation And Replay Gates

- Recommendations are derived only from episodes that include both `recommendation` and `outcomeLink`.
- `draft_only` remains hidden unless `includeDraftOnly=true`.
- Replay scoring considers success, partial outcomes, failures, rejected approvals, and user corrections.
- Policy promotion requires replay validation, shadow replay readiness, safe precision, negative-outcome bounds, and failure-cost bounds from workspace governance.

## Provenance

- Recommendation payloads include bounded provenance references: episode IDs, goal IDs, task IDs, memory IDs, action-log IDs, evidence IDs, and graph root IDs.
- `GET /api/provenance/graph?recommendationKey=<key>` resolves owner-scoped learning episodes for that recommendation and pulls linked owner goals into the graph.
- Provenance graph responses may include restricted owner memories for audit views, but they remain scoped to the authenticated principal.

## Rollback

- Disable recommendation consumers or omit `recommendationKey` graph queries to stop using the learning flywheel without deleting stored episodes.
- To suppress stale or unsafe guidance, record rejected or edited feedback; replay gates will downgrade the recommendation to review-required or draft-only.
- To remove historical influence, expire affected episode files or move them out of the self-improvement store and rerun the targeted recommendation tests.

## Validation

Run the targeted flywheel suite before merging changes in this area:

```bash
npm exec -- vitest run tests/self-improvement-memory.test.ts tests/memory-capture.test.ts tests/recommendations-route.test.ts tests/recommendation-feedback-route.test.ts tests/provenance-graph-route.test.ts
npm run test:security:regression
npm run build
```
