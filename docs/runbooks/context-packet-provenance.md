# Context Packet Provenance

Context packets are the API-facing projection of stored memory records. They preserve the original memory record as the durable source of truth while exposing provenance, freshness, consent, retention, sensitivity, transformations, and usage-ready lineage for retrieval and audit surfaces.

## Runtime Surface

- `GET /api/context/packets` returns context packets for the authenticated principal.
- `POST /api/context/packets` captures a memory record and returns the derived packet.
- Packets use stable IDs in the form `ctx_<memoryId>`.
- Raw memory content is not exposed as a separate packet field. The packet includes `contentSummary`, bounded to 500 characters.

## Filtering Rules

- The API scopes all queries to the authenticated user.
- Expired memory records are excluded unless `includeExpired=true`.
- `restricted` sensitivity is excluded by default. Diagnostic callers must pass an explicit `sensitivity=restricted` filter.
- `agent=<agentName>` requires that the memory permissions include that agent.
- `limit` is capped by the service to avoid unbounded packet scans.

## Provenance Fields

- `source` identifies the memory record and capture source.
- `consent` records the consent basis and grant actor when available.
- `retention` carries review and expiry timestamps.
- `freshness` is derived from confidence, review, and expiry metadata.
- `lineage.sourceMemoryIds` points back to source memories.
- `transformations` records the derivation from memory into a packet.

## Operational Notes

- Context packets currently derive from memory records rather than using a second storage table. This keeps rollback simple: disable the API route or stop callers from using it, and no new data model must be unwound.
- If later packet-specific usage tracking needs durable history, add an append-only `context_packet_usage` table and keep packet IDs stable.
