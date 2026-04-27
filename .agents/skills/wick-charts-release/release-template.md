# Release notes template

Two shapes — pick by version delta.

## Patch release (0.X.Y → 0.X.Y+1)

Flat bullet list, no area sections.

```markdown
## 🐛 <Headline>

<1-2 sentence lead — what the user notices.>

- Bullet 1
- Bullet 2
- Bullet 3

**Full Changelog**: https://github.com/mo4islona/wick-charts/compare/<PREV>...vNEW
```

## Minor / major release (0.X.Y → 0.X+1.0 or 1.0.0)

Sectioned. Use only the sections that apply.

```markdown
## ✨ <Headline>

<1-3 sentence lead — what changed for the user, not the implementation.>

### Highlights
- **Bold lede** — short explanation.
- **Bold lede** — short explanation.

### Viewport
- ...

### Y-range
- ...

### Series
- ...

### Navigator
- ...

### API
- `<new prop or method>` — short description.
- `<type>` re-exported from `@wick-charts/<pkg>`.

### Playground
- ...

### Tests
- N new tests; <total>/<total> passing, typecheck and api:check clean.

**Full Changelog**: https://github.com/mo4islona/wick-charts/compare/vPREV...vNEW
```

## Headline emoji conventions

- ✨ feature work, new architecture
- 🐛 bug-fix-only release
- 🎨 themes / visual changes
- ⚡ performance
- 📚 docs-only
- 🔧 tooling / build / infra

## Style rules

- **No version in the title** — GitHub renders the tag separately.
- **Lead with user-visible impact**, not internal mechanism. "Streaming no longer pops the navigator" beats "Replaced exponential chase with Animator".
- **Bold the lede of each highlight bullet** so the page scans in 5 seconds.
- **Don't restate the commit message verbatim.** The commit body is the engineer's-eye view; the release notes are the user's.
- **Skip "Tests" on patch releases** unless the headline is *about* test coverage.
- **End with the compare link** — readers who want the full diff click through.
