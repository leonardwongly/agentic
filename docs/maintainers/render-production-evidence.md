# Render Production Evidence

This note preserves historical maintainer evidence for the first production-like
Render investigation. It is not required setup for open-source users or fork
owners.

## Historical Blocker

- `render blueprints validate deploy/render/render.yaml --output json` reached
  Render but returned `need_payment_info` for `agentic-postgres`,
  `agentic-web`, and `agentic-worker`.
- No Render services or datastores were created during that validation.
- The blocker belonged to the maintainer's Render workspace, not to the Agentic
  source code.
- A free-only Blueprint rewrite was not accepted as a production proof because
  the required deployment shape includes a background worker, Postgres, stable
  HTTPS ingress, migration gating, and rollback authority.

## Maintainer-Only Commands

Use these only from a maintainer shell that is intentionally connected to the
canonical upstream repository and provider account:

```bash
render workspace current --output json
render blueprints validate deploy/render/render.yaml --output json
render services list --output json
```

For open-source deployments, use
[`docs/deployment/self-hosted.md`](../deployment/self-hosted.md) or replace all
repository, provider, hostname, and secret values with installer-owned values.
