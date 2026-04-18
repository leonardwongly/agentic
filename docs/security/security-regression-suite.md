# Security Regression Suite

The security regression suite provides a fast, explicit gate for high-signal abuse
paths that must remain fail-closed as the product surface grows.

## Scope

The suite groups deterministic tests into five categories:

- `input-validation`: malformed JSON, schema enforcement, and sanitized failures
- `auth-and-session`: session validation, OAuth state integrity, and callback abuse
- `scope-and-governance`: tenant isolation and governed route boundaries
- `idempotency-and-public-surfaces`: duplicate submission protection and anonymous route safety
- `durable-execution`: retry safety, dead-letter handling, and worker failure behavior

## Run

```bash
npm run test:security:regression
```

The command prints a concise inventory summary before running the curated Vitest
files. CI runs the suite ahead of the full test pass so regressions in abuse
handling fail quickly and with a narrower signal.
