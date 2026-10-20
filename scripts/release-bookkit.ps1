<#
.SYNOPSIS
    Release Hugo Bookkit - tag, push, and update consumer sites.

.DESCRIPTION
    This script automates the Bookkit release process:
    1. Validates working tree is clean
    2. Runs tests and builds
    3. Creates annotated tag
    4. Pushes tag to origin
    5. Generates release notes template
    6. Provides commands to update consumer sites (programmer.ie)

.PARAMETER Version
    New version (e.g., "v0.4.0"). If omitted, suggests next patch version.

.PARAMETER SkipTests
    Skip test suite (not recommended).

.PARAMETER DryRun
    Show what would be done without executing.

.PARAMETER NoPush
    Don't push tag to origin.

.EXAMPLE
    .\scripts\release-bookkit.ps1 -Version v0.4.0

.EXAMPLE
    .\scripts\release-bookkit.ps1 -Version v0.3.2 -SkipTests

.EXAMPLE
    .\scripts\release-bookkit.ps1 -DryRun
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$Version = "",

    [Parameter(Mandatory=$false)]
    [switch]$SkipTests,

    [Parameter(Mandatory=$false)]
    [switch]$DryRun,

    [Parameter(Mandatory=$false)]
    [switch]$NoPush
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info { param([string]$msg) Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$msg) Write-Host "  [ERR] $msg" -ForegroundColor Red }
function Write-Step { param([string]$msg) Write-Host "`n$msg" -ForegroundColor Cyan }

$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot

try {
    Write-Step "[BOOKKIT] Release Script"
    Write-Host "  Repository: $repoRoot"

    # 1. Check working tree
    Write-Step "1. Checking working tree..."
    $status = git status --porcelain
    if ($status) {
        Write-Err "Working tree not clean. Commit or stash changes first:"
        Write-Host $status
        exit 1
    }
    Write-Ok "Working tree clean"

    # 2. Get current version and suggest next
    Write-Step "2. Determining version..."
    $tags = git tag --list "v*" --sort=-v:refname
    $latestTag = $tags[0]
    if (-not $latestTag) { $latestTag = "v0.0.0" }
    Write-Info "Latest tag: $latestTag"

    if (-not $Version) {
        # Suggest next patch version
        if ($latestTag -match '^v(\d+)\.(\d+)\.(\d+)$') {
            $major = [int]$matches[1]
            $minor = [int]$matches[2]
            $patch = [int]$matches[3] + 1
            $suggested = "v$major.$minor.$patch"
        } else {
            $suggested = "v0.1.0"
        }
        $Version = Read-Host "  Enter new version (e.g., $suggested)"
        if (-not $Version) { Write-Err "Version required"; exit 1 }
    }

    if ($Version -notmatch '^v\d+\.\d+\.\d+(-.+)?$') {
        Write-Err "Version must match semantic versioning (e.g., v0.4.0 or v0.4.0-beta.1)"
        exit 1
    }

    # Check if tag already exists
    if (git tag -l $Version) {
        Write-Err "Tag $Version already exists"
        exit 1
    }

    Write-Ok "Version: $Version"

    # 3. Run tests
    if (-not $SkipTests) {
        Write-Step "3. Running tests..."
        if ($DryRun) { Write-Warn "[DryRun] Would run: python -m pytest tests/ -v" }
        else {
            python -m pytest tests/ -v
            if ($LASTEXITCODE -ne 0) { Write-Err "Tests failed"; exit 1 }
            Write-Ok "All tests passed"
        }
    } else {
        Write-Warn "Skipping tests (--SkipTests)"
    }

    # 4. Build exampleSite
    Write-Step "4. Building exampleSite..."
    if ($DryRun) { Write-Warn "[DryRun] Would run: hugo --gc --minify --panicOnWarning in exampleSite" }
    else {
        Push-Location "exampleSite"
        hugo --gc --minify --panicOnWarning
        if ($LASTEXITCODE -ne 0) { Write-Err "Build failed"; exit 1 }
        Pop-Location
        Write-Ok "exampleSite build successful"
    }

    # 5. Validate module
    Write-Step "5. Validating Hugo module..."
    if ($DryRun) { Write-Warn "[DryRun] Would run: hugo mod verify" }
    else {
        hugo mod verify
        if ($LASTEXITCODE -ne 0) { Write-Err "Module verification failed"; exit 1 }
        Write-Ok "Module verified"
    }

    # 6. Generate changelog hint
    Write-Step "6. Generating changelog context..."
    $since = if ($latestTag -ne "v0.0.0") { "$latestTag..HEAD" } else { "HEAD" }
    $commits = git log --oneline --no-merges $since
    $commitCount = ($commits -split "`n").Count
    Write-Info "Commits since ${latestTag}: $commitCount"
    Write-Host $commits

    # 7. Create annotated tag
    Write-Step "7. Creating tag $Version..."
    $tagMessage = @"
Bookkit $Version

Released: $(Get-Date -Format 'yyyy-MM-dd')

Changes since ${latestTag}:
$commits

See CHANGELOG.md for full history.
"@

    if ($DryRun) {
        Write-Warn "[DryRun] Would create tag: git tag -a $Version -m <message>"
    } else {
        git tag -a $Version -m $tagMessage
        Write-Ok "Tag created: $Version"
    }

    # 8. Push tag
    if (-not $NoPush) {
        Write-Step "8. Pushing tag to origin..."
        if ($DryRun) {
            Write-Warn "[DryRun] Would push: git push origin $Version"
        } else {
            git push origin $Version
            if ($LASTEXITCODE -ne 0) { Write-Err "Push failed"; exit 1 }
            Write-Ok "Tag pushed to origin"
        }
    } else {
        Write-Warn "Skipping push (--NoPush). Run manually: git push origin $Version"
    }

    # 9. Consumer update instructions
    Write-Step "9. Consumer site update (programmer.ie)"
    $consumerCmds = @"
  Run these commands in programmer.ie:

  cd C:/Projects/programmer.ie
  # Remove any local replace directive first
  go get github.com/ernanhughes/hugo-bookkit@$Version
  hugo mod vendor
  # Test build
  hugo --gc --minify --panicOnWarning
  # Commit go.mod, go.sum, _vendor/
  git add go.mod go.sum _vendor/
  git commit -m "chore: upgrade hugo-bookkit to $Version"
"@
    Write-Host $consumerCmds

    # 10. GitHub Release reminder
    Write-Step "10. GitHub Release"
    $releaseUrl = "https://github.com/ernanhughes/hugo-bookkit/releases/new?tag=$Version"
    Write-Host "  Create a GitHub release at: $releaseUrl"
    Write-Host "  Use the commit log above as release notes, or write a summary."

    Write-Step "[DONE] Release $Version complete!"
    Write-Info "Next steps:"
    Write-Host "  1. Create GitHub release with changelog"
    Write-Host "  2. Update programmer.ie (see commands above)"
    Write-Host "  3. Test programmer.ie build with new version"

} catch {
    Write-Err "Error: $($_.Exception.Message)"
    exit 1
} finally {
    Pop-Location
}