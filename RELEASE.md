## Release process

BookKit uses [Semantic Versioning](https://semver.org/) with `v` prefix (e.g., `v0.4.0`).

### Local development

```bash
# In consumer site (e.g., programmer.ie)
cd C:/Projects/programmer.ie
# Add replace directive to go.mod
replace github.com/ernanhughes/hugo-bookkit => C:/Projects/hugo-bookkit

# Re-vendor to test local changes
hugo mod vendor
hugo --gc --minify --panicOnWarning
```

### Creating a release

Use the PowerShell release script (Windows):

```powershell
# From hugo-bookkit repo root
.\scripts\release-bookkit.ps1 -Version v0.4.0
```

The script:
1. ✅ Verifies clean working tree
2. ✅ Runs test suite (`pytest tests/`)
3. ✅ Builds `exampleSite` with `--panicOnWarning`
4. ✅ Verifies Hugo module
5. ✅ Creates annotated tag with commit log
6. ✅ Pushes tag to origin
7. ✅ Outputs consumer update commands

### Updating consumer sites (programmer.ie, aibussin.com)

```bash
cd C:/Projects/programmer.ie

# Remove any local replace directive from go.mod first
go get github.com/ernanhughes/hugo-bookkit@v0.4.0
hugo mod vendor

# Test build
hugo --gc --minify --panicOnWarning

# Commit changes
git add go.mod go.sum _vendor/
git commit -m "chore: upgrade hugo-bookkit to v0.4.0"
```

### Key points

| Step | Command | Purpose |
|------|---------|---------|
| Tag | `git tag -a v0.4.0 -m "..."` | Immutable release marker |
| Push tag | `git push origin v0.4.0` | Publishes to GitHub |
| Consumer update | `go get ...@v0.4.0` | Updates `go.mod`/`go.sum` |
| Re-vendor | `hugo mod vendor` | **Critical** — updates `_vendor/` (what Hugo actually uses) |
| Build test | `hugo --panicOnWarning` | Verifies no regressions |

> **⚠️ Always run `hugo mod vendor` in consumer sites after version change.** Hugo uses `_vendor/` over the module cache. Forgetting this step means the consumer builds against stale code.

### GitHub Release

After pushing the tag, create a GitHub release:
- URL: `https://github.com/ernanhughes/hugo-bookkit/releases/new?tag=v0.4.0`
- Use commit log from release script as starting point for release notes
- Reference consumer sites tested