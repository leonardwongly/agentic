# Parallel Worktree Runbook

## Purpose

This runbook turns the Agentic multi-stream delivery model into a repeatable operating pattern. The goal is to compress calendar time without trading away security, merge safety, or review quality.

Use this runbook when more than one roadmap stream needs to move at the same time and the repo has enough shared surface area that unmanaged parallel branches would collide.

## Boundaries

Inputs:

- the current repository root
- the base branch that all streams should branch from
- the set of roadmap issues to execute in parallel
- local filesystem paths where sibling worktrees can be created

Outputs:

- one dedicated worktree per owned stream
- non-overlapping branch names and directory names
- explicit file ownership and merge order
- a final integrated commit on the main repo branch

Trust levels:

- issue scope and local branch names are trusted only after operator review
- worktree paths, branch prefixes, and all CLI arguments are treated as untrusted and validated before git commands run
- shared hot-spot files are protected by ownership rules, not by social convention alone

## Failure Modes

The model is designed to reduce these specific failures:

1. Branch collision: two contributors create the same branch name or reuse the same worktree path.
2. Shared-file churn: multiple streams edit the same index, dashboard shell, or CI file and create rebase-heavy conflicts.
3. Hidden dependency drift: intelligence work starts before governance and connector contracts stabilize.
4. Partial merge hazards: one stream lands without the tests or validation required for the overall milestone.
5. Orphan worktrees: local parallel branches survive after integration and create false-positive dirty-state confusion.

## Success Criteria

The model is working when:

- each stream has one owner and a bounded write surface
- setup is reproducible from a single command
- status can be inspected from the repo root without manually entering each worktree
- cleanup is reproducible from a single command with safety checks
- merge order is explicit
- full validation still happens on the integrated branch before commit

## Stream Layout

The checked-in planner defines five standard streams:

1. `spine`
Shared contracts, shared exports, merge integration, and conflict resolution.

2. `secops`
`LEO-87`, `LEO-88`, `LEO-89`

3. `connectors`
`LEO-72`

4. `governance`
`LEO-76`

5. `intelligence`
`LEO-78`, `LEO-81`

The `spine` stream exists to freeze the interfaces that would otherwise become merge hotspots. If the interfaces are already stable for a smaller rollout, the setup CLI supports `--no-spine`.

## Ownership Rules

Single-owner files that should not be edited freely across streams:

- `packages/contracts/src/index.ts`
- `packages/repository/src/index.ts`
- `apps/web/components/dashboard.tsx`
- `apps/web/app/globals.css`
- `.github/workflows/ci.yml`

CI enforcement rule:

- shared protected files are spine-only on stream branches
- stream-protected files are only allowed from their owning stream branch
- the integrated base branch is allowed to carry protected-file changes after merge
- if a protected file is edited from an unowned branch, `npm run test:parallel-worktree:fitness` fails

Expected stream ownership:

- `spine`
  - shared contracts
  - top-level re-exports
  - shell-level integration points
  - final conflict resolution

- `secops`
  - public/high-cost route protection
  - compliance evidence scripts
  - runtime audit and vulnerability automation

- `connectors`
  - provider adapters
  - connector readiness reporting
  - connector failure semantics

- `governance`
  - policy simulation
  - governance API routes
  - audit and conformance explainability

- `intelligence`
  - recommendation traces
  - outcome learning
  - self-improvement memory and next-best-action logic

## Merge Order

Use this order unless a smaller rollout has a narrower dependency graph:

1. `spine`
2. `secops`, `connectors`, and `governance` in any order once the shared interfaces are stable
3. `intelligence` after connector and governance contracts are stable
4. final integrated validation on the main repo branch

Do not treat a clean git merge as proof of correctness. Integration is complete only after the merged branch passes the required validation suite.

## CLI Commands

Resolve issue-theme validation gates before assigning a stream:

```bash
npm run ci:issue-theme-gates -- --label aos-shell
```

For a branch that already has local changes, resolve gates from the diff:

```bash
npm run ci:issue-theme-gates -- --from-git --base-ref origin/main
```

Create the standard sibling worktrees from the repo root:

```bash
npm run worktree:setup
```

Preview the plan without creating anything:

```bash
npm run worktree:setup -- --print-only
```

Create worktrees under a custom root or from a different base branch:

```bash
npm run worktree:setup -- --root ../parallel --base-branch release/2026.04
```

Inspect the current status of all planned worktrees:

```bash
npm run worktree:status
```

Inspect stale branches, stale PRs, and dirty worktrees without mutating anything:

```bash
npm run hygiene:repo -- --max-age-days 21
```

Emit machine-readable status for automation or dashboards:

```bash
npm run worktree:status -- --json
npm run hygiene:repo -- --json
```

Preview safe cleanup after the integrated branch is committed:

```bash
npm run worktree:cleanup -- --print-only
```

Remove clean worktrees and delete fully merged stream branches:

```bash
npm run worktree:cleanup
```

## Execution Workflow

1. Confirm the roadmap slice and stream ownership before branching.
2. Run `npm run worktree:setup -- --print-only` and review the planned paths and branches.
3. Run `npm run worktree:setup` once the plan is accepted.
4. Work inside each stream only on owned files and tests.
5. Validate each stream locally with the narrowest relevant test suite.
6. Merge streams back into the main repo branch in the documented order.
7. Run integrated validation:

```bash
npm run test:security:regression
npm run test:architecture:fitness
npm run test:parallel-worktree:fitness
npm run test:performance:fitness
npm test
npm run build
```

8. Commit only the intended source, script, and test files.
9. Leave unrelated local docs or artifact noise out of the commit unless they are part of the planned rollout.

## Cleanup

After the integrated branch is committed:

1. Confirm the main repo is clean except for intentional local-only files.
2. Preview cleanup:

```bash
npm run worktree:cleanup -- --print-only
npm run hygiene:repo -- --max-age-days 21
```

3. Run cleanup once the plan looks correct:

```bash
npm run worktree:cleanup
```

4. Keep stream branches intentionally when needed:

```bash
npm run worktree:cleanup -- --keep-branches
```

## Notes

- The setup CLI intentionally fails if a target worktree path or branch already exists.
- The status CLI reports missing worktrees explicitly so stale local assumptions do not hide broken parallel setup.
- The cleanup CLI fails closed on dirty worktrees and unmerged branches instead of performing partial cleanup.
- The architecture fitness check is the CI guardrail for protected-file ownership, so shared hot-spot files cannot drift across stream branches unnoticed.
- The model is meant to reduce conflicts, not to replace normal review discipline. Security, correctness, and full integrated validation remain mandatory.
