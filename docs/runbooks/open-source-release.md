# Open-Source Release Checklist

Use this checklist before publishing a GitHub release.

## Scope

The release is a GitHub source release, not an npm package publication. The
root package remains `private: true` so workspaces are not accidentally
published to npm.

## Required Evidence

1. The release branch is clean and based on `origin/main`.
2. Open PRs have been reviewed or merged.
3. `package.json` has the intended release version.
4. `CHANGELOG.md` includes the release entry.
5. Public onboarding explains fork and self-host ownership.
6. Provider-neutral deployment docs exist.
7. Maintainer-specific provider evidence is separated from installer setup.
8. The OSS ownership guard runs in CI and local CI.
9. No local artifacts, secrets, or generated packages are staged.
10. CI passes on the merge commit that will be tagged.

## Local Gate

```bash
npm ci
npm run lint
npm run typecheck
npm run format:check
npm run test:oss:ownership
npm test
npm run test:security:regression
npm run test:architecture:fitness
npm run docs:render
npm run docs:validate
npm run build
npm run release:check-context
```

## Release Creation

After the merged `main` commit is green:

```bash
git fetch origin main --tags
git checkout main
git pull --ff-only origin main
git tag --annotate v1.0.0 --message "v1.0.0"
git push origin v1.0.0
gh release create v1.0.0 \
  --repo leonardwongly/agentic \
  --title "Agentic v1.0.0" \
  --notes-file CHANGELOG.md \
  --verify-tag
```

If the local `main` checkout is dirty, create the tag from a clean worktree
instead of resetting the dirty checkout.

## Rollback

If a release problem is found after publishing:

1. Mark the GitHub release as a pre-release or delete the release entry.
2. Open a fix-forward PR against `main`.
3. Publish `v1.0.1` after validation passes.
4. Avoid rewriting published tags unless the tag was created incorrectly and no
   downstream users have consumed it.
