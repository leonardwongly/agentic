# Workflow DAG contracts

Workflow DAGs are planning contracts for multi-step work. They are validated before execution so dependency ordering, fan-out, cancellation, retry, permission, and compensation behavior is explicit instead of inferred from free-form task text.

## Contract

Each DAG has:

- a stable `id`, `workflowId`, `schemaVersion`, and timestamps
- one to 250 typed nodes
- zero to 1,000 directed edges
- node-level dependencies through `dependsOn`
- node-level `actionIntent`, `permissionGrant`, `retryPolicy`, and `compensation`

The contract rejects:

- duplicate node ids
- dependencies or edges that reference missing nodes
- self-referential edges
- dependency or edge cycles
- action intents whose capabilities are not covered by the node permission grant
- action risk classes above the node permission ceiling
- required compensation without a concrete compensation action intent
- illegal instance or node status transitions
- retry attempts after the node retry policy is exhausted

## Execution Boundary

The current DAG contract is an in-process planning and transition model. It normalizes task dependencies, fan-out, pause/resume/cancel behavior, and node retry state, but it does not persist DAG instances or run a generic DAG worker executor yet. Durable job execution remains the persisted runtime boundary.

If a future change adds persisted DAG instances or a DAG worker executor, it must define:

- storage schema and migration rollback behavior
- idempotency keys for each executable node
- worker claim and lease semantics
- per-node side-effect ledger integration
- operator replay and cancellation rules
- tenant and workspace authorization checks at every mutation boundary

## Security Notes

- Treat model-generated DAGs as untrusted until they pass schema and execution validation.
- Do not let a node permission grant exceed the authority already allowed by policy and approval state.
- External side-effect nodes must still pass typed action validation, connector readiness, approval, and provider idempotency gates.
- Cancellation is an operator control signal, not a rollback guarantee for already completed provider side effects.
- Compensation actions must be explicit when a node claims compensation is required.

## Performance Notes

DAG validation is linear in the number of nodes plus edges for adjacency and cycle checks. The schema caps keep validation bounded at 250 nodes and 1,000 edges. Avoid provider calls, database scans, or long-running work inside DAG validation; those belong to durable jobs or provider adapters after the plan is accepted.

## Validation

Run the focused W05-T01 gate after changing DAG contracts:

```bash
npm exec -- vitest run tests/workflow-dag.test.ts tests/execution.test.ts
npm run test:architecture:fitness
npm run test:performance:fitness
```

Run the broader W05 runtime gate before closing the parent issue:

```bash
npm exec -- vitest run tests/worker-runtime.test.ts tests/execution.test.ts tests/repository.test.ts
npm run test:architecture:fitness
npm run test:performance:fitness
```

## Rollback

Rollback is safe by reverting DAG contract, transition, test, and documentation changes. The current contract closeout introduces no migrations, persisted DAG instance writes, provider calls, or external side effects.
