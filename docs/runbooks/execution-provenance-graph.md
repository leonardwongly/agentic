# Execution Provenance Graph

The execution provenance graph answers how a goal moved through decisions, approvals, actions, durable jobs, context packets, outputs, and failures. It is a query projection over existing repository data rather than a new write path.

## Runtime Surface

- `GET /api/provenance/graph` returns the authenticated user's graph.
- Query parameters:
  - `rootId`: optional graph node ID such as `goal:<goalId>` or `job:<jobId>`.
  - `depth`: traversal depth from `0` to `4`, default `2`.
  - `limit`: maximum nodes from `1` to `500`, default `250`.

## Node Types

- `goal`
- `approval`
- `decision`
- `action`
- `job`
- `memory`
- `context_packet`
- `output`
- `failure`

## Edges

Edges describe causal or derivation relationships, including `queued`, `executed`, `produced`, `decided`, `failed`, `replayed_from`, and `derived_from`.

## Security and Redaction

- The route fetches goals, jobs, memory, and evidence using the authenticated user ID.
- Job payloads and raw memory records are not copied into graph metadata.
- Memory content appears only through the existing bounded context packet summary.
- The graph node limit prevents unbounded traversal responses.

## Rollback

Because the graph is read-only and derived from existing repository records, rollback is limited to disabling the route or removing callers. No data migration is required.
