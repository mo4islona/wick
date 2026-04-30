---
name: wick-charts-release
description: Cut a new Wick Charts release — bump versions across packages, tag, push, watch the Release workflow, and publish standardized GitHub release notes. Use when the user asks to "release", "publish", "cut v0.X.Y", or "ship".
metadata:
  internal: true
---

# Wick Charts release

End-to-end release procedure. Bumps `packages/{core,react,vue,svelte}/package.json` to a single shared version, tags `vX.Y.Z`, pushes, watches the `Release` workflow, then rewrites the auto-generated GitHub release notes with the standardized format.

## Preconditions

Confirm before starting:
- `git status` is clean on `main` (or the user has staged the version bump deliberately).
- The user named a target version, e.g. `0.3.5`. If not, ask.
- All four packages currently sit at the same version (`pnpm -r exec node -p "require('./package.json').version"`).

## Steps

### 1. Bump versions

Update **all four** packages to the same version:
- `packages/core/package.json`
- `packages/react/package.json`
- `packages/vue/package.json`
- `packages/svelte/package.json`

The release workflow's `Verify versions` step rejects mismatches between react/vue/svelte and the tag. Core is private (workspace-internal) but bump it too for consistency.

### 2. Commit and tag

```sh
git add packages/*/package.json
git commit -m "chore(release): X.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

Both pushes are required — the workflow triggers on `tags: ['v*']`.

### 3. Watch the workflow

```sh
gh run watch --repo mo4islona/wick-charts --exit-status
```

Or list + tail the latest:

```sh
RUN_ID=$(gh run list --repo mo4islona/wick-charts --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --repo mo4islona/wick-charts --exit-status
```

The workflow has three jobs: `check` → `publish` → `github-release`. Total ~3–5 min. If `publish` fails on npm Trusted Publishing, the trusted publisher config on npmjs.com may be missing — surface the error to the user, don't retry blindly.

### 4. Rewrite release notes

The `github-release` job creates the release with `generate_release_notes: true` (auto-generated GitHub bullet list). Replace it with the standardized format from [release-template.md](release-template.md).

Source the highlights from the merge commit message body — it's already structured by area. Don't restate every bullet from the commit; pick the user-visible changes.

```sh
gh release edit vX.Y.Z --repo mo4islona/wick-charts --notes "$(cat <<'EOF'
...standardized notes...
EOF
)"
```

### 5. Confirm

Print the release URL: `https://github.com/mo4islona/wick-charts/releases/tag/vX.Y.Z`

## Release notes format

See [release-template.md](release-template.md). Rules:

- **Title line**: `## <Headline>` — one phrase, no version (the GitHub UI shows the tag). No emoji.
- **Lead paragraph**: 1–3 sentences. What changed for the user, not the implementation.
- **Sections**: `### Highlights` is required. Add area sections (`### Viewport`, `### API`, `### Playground`, etc.) only for minor/major releases. Patch releases stay flat.
- **Tests/internal**: only mention if the user-facing impact is "we now have confidence in X" — otherwise skip.
- **Footer**: always end with `**Full Changelog**: https://github.com/mo4islona/wick-charts/compare/<PREV>...vNEW`. Resolve `<PREV>` as the previous tag if it exists, otherwise the parent commit SHA: `git rev-parse vNEW^ | cut -c1-7`. Don't blindly write `vPREV` — early tags are missing and the link 404s.
- **No install block.** Don't paste `npm i @wick-charts/...` into the notes — install instructions live in the README and on the docs site. Release notes are for *what changed*.
- Keep it short. The full commit message lives in `git log` for anyone who wants the deep dive.

## Failure modes

- **Tag exists**: `git tag vX.Y.Z` fails. Either the user already started the release or a previous attempt didn't complete. Check `gh release view vX.Y.Z` and `gh run list --workflow=release.yml`. Don't force-delete tags without confirming.
- **`Verify versions` fails in CI**: one of `packages/{react,vue,svelte}/package.json` doesn't match the tag. Fix locally, commit, retag, repush.
- **Publish fails on one package**: npm Trusted Publishing is configured per-package. If react publishes but vue 404s, the vue trusted publisher config is missing on npmjs.com. The release is now half-published — flag clearly to the user and don't proceed to the GitHub release rewrite until resolved.
