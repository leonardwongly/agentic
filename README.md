# Agentic

Agentic is a single-user agentic assistant MVP with a modular-monolith architecture and a reproducible `agentic.docx` document pipeline.

## Workspace layout

- `apps/web`: Next.js web UI and HTTP JSON API routes
- `packages/*`: typed contracts and service modules
- `docs/specs/agentic.md`: canonical source of truth for the concept document
- `docs/templates/reference.docx`: Word template/reference used for rendering
- `scripts`: document rendering and validation helpers

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Optional: point the app at Postgres:

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/agentic
```

3. Configure the single-user access key:

```bash
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
```

In local development only, the app falls back to `agentic-local-dev-key` if `AGENTIC_ACCESS_KEY` is not set. Production should always use an explicit secret.

4. Start the web app:

```bash
npm run dev
```

5. Render and validate the document:

```bash
npm run docs:build
```

6. Run tests:

```bash
npm test
```

7. Run browser E2E coverage:

```bash
npx playwright install chromium
npm run test:e2e
```

## Persistence modes

- If `DATABASE_URL` is set, the app uses the Postgres-backed repository.
- Otherwise it falls back to a file-backed single-user store at `.agentic/runtime-store.json` so the scaffold remains runnable before the database is provisioned.
- `AGENTIC_RUNTIME_STORE_PATH` overrides the file-backed store path when you need isolated local or test storage.
- `AGENTIC_NOTES_PATH` overrides the local notes directory used by the filesystem-backed notes adapter.

## Notes

- The root `agentic.docx` is treated as migration input only.
- The supported generated artifact is `build/agentic.docx`.
- API routes are protected by a single-user session cookie created through `/api/session`.
- The first real adapter is a local notes provider that reads and writes Markdown files under `.agentic/notes`.
