# Runtime Eventing, Dashboard Surfaces, Migration Discipline, and Governance Simulation

This runbook covers the AOS-15 through AOS-18 operating controls.

## Job Event Streams

- Endpoint: `GET /api/jobs/:id/events`
- Transport: Server-Sent Events with `event: job.snapshot`
- Auth boundary: same API session/access-key enforcement as job polling
- Replay hint: clients may send `Last-Event-ID`; the stream resumes with monotonic event IDs for new snapshots
- Fallback: dashboard clients fall back to existing JSON polling when `EventSource` is unavailable, errors, or the stream times out
- Timing controls: `pollMs`, `heartbeatMs`, and `timeoutMs` are bounded server-side

Rollback: leave the endpoint deployed and set dashboard callers to `preferEventStream: false`, or revert the dashboard helper change. The polling routes remain the compatibility contract.

## Dashboard OS Surfaces

The dashboard surface registry in `apps/web/lib/dashboard-surface.ts` defines the maintainable OS boundaries:

- `command`
- `operations`
- `agents`
- `governance`
- `memory`
- `provenance`
- `observability`

Each surface declares its route anchor, component boundary, section ownership, and loading/empty/error/permission states. Keep new advanced dashboard work assigned to one of these surfaces before adding UI.

Rollback: registry-only changes are safe to revert independently because existing dashboard rendering still uses the legacy component structure.

## Migration Discipline

Required before merging a migration:

- filename follows `0000_snake_case.sql`
- numeric prefix is unique for all new migrations
- SQL file order is lexicographic
- rollback note is added to `packages/db/migrations/ROLLBACK.md`
- destructive SQL is explicitly reviewed

Run:

```bash
npm run db:check-migrations
npm run db:migrate
npm run db:status -- --require-ready
```

Legacy duplicate prefixes `0004` and `0005` are reported as warnings for compatibility. Do not add new duplicate prefixes.

Rollback: migration rollback must follow the per-file note in `ROLLBACK.md`; destructive rollback requires a backup restore or a new forward migration.

## Governance Simulation Calibration

Run:

```bash
npm run governance:simulate
```

The continuous simulation suite measures:

- false allows
- false denies
- escalation rate
- scenario coverage
- latency

Risky autonomy expansion is allowed only when calibration status is `pass`. Any false allow fails the gate.

Rollback: disable the risky autonomy expansion first, then update or remove the scenario expectation that is no longer valid.
