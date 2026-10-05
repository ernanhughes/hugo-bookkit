# Hugo BookKit

Hugo BookKit is a reusable Hugo Module for publishing technical books without copying layouts, CSS, JavaScript, or reader behavior between repositories.

It owns the **book runtime**: book landing pages, chapter pages, cover handling, publication status, store links, chapter navigation, reading progress, MathJax, Mermaid, and the shared visual system. The consuming site owns its brand, menus, analytics, content, and any site-specific integrations.

## Install

Initialize Hugo Modules in the consuming site if needed:

```bash
hugo mod init github.com/OWNER/MY-BOOK
```

Import BookKit from `hugo.toml`:

```toml
[module]
  [[module.imports]]
    path = "github.com/ernanhughes/hugo-bookkit"
```

Then run:

```bash
hugo mod get -u
hugo server
```

For local BookKit development, add a Go module replacement in the consuming site's `go.mod`:

```go
replace github.com/ernanhughes/hugo-bookkit => ../hugo-bookkit
```

## Content shape

BookKit expects books under the `books` section by default:

```text
content/
└── books/
    ├── _index.md
    └── my-book/
        ├── _index.md
        ├── 01-chapter.md
        ├── 02-chapter.md
        └── cover.jpg        # optional page resource
```

A book's `_index.md` can use:

```yaml
---
title: "My Book"
description: "What the book teaches."
publication_status: development
# Optional for an already-published book being revised:
# revision_status: rewrite
stores:
  - label: Amazon
    kind: amazon
    url: https://example.com/
---
```

Book lifecycle values are `research`, `development`, `final-review`, `coming-soon`, and `published`. Published books can additionally set `revision_status` to `revision` ("New edition in progress") or `rewrite` ("Major rewrite underway"). Publication and revision are intentionally separate so a book can remain published while a new edition is being rebuilt.

A chapter should set `weight` to control order. If the filename starts with digits, BookKit uses those digits as the visible chapter number; otherwise it falls back to position.

## Configuration

BookKit uses the namespaced `params.bookkit` configuration. Defaults ship with the module and can be overridden by the consuming site:

```toml
[params.bookkit]
  brandLabel = "Book"
  reader = true
  progress = true
  accent = "#3978c5"
  coverRoot = "/images/books"
  # Optional physical source used to test cover existence when static files
  # are materialized outside the normal static directory.
  coverSourceRoot = "static/images/books"
  storagePrefix = "hugo-bookkit:progress:"
  showStatus = true
  showStores = true
  # Optional consuming-site partial hooks:
  # bookExtraPartial = "book-apply-link.html"
  # chapterBeforeContentPartial = "book-visuals.html"
  # chapterActionsPartial = "my-chapter-actions.html"

  [params.bookkit.features]
    math = true
    mermaid = true
    research = true

  [params.bookkit.research]
    dataRoot = "content/research/chapters"
    apiBase = ""
    refreshUI = false
    warnMissingDossier = false
```

## Research reader support

## Book catalogue card

Sites that want the catalogue without copying markup can render each book
through the reusable card. It is site-neutral: covers, status, formats and
store links come from book metadata, and any consumer-specific relation
(solutions, tools, courses) passes through the generic relation slot:

```gohtml
{{ range .Sections.ByWeight }}
  {{ partial "bookkit/book-card.html" (dict
      "book" .
      "size" "card"
      "relationURL" .Params.solution_url
      "relationTitle" .Params.solution_title
  ) }}
{{ end }}
```

Card presentation lives in BookKit CSS (`bookkit-book-card*` classes driven
by `--bookkit-*` variables), so consumers brand it without forking markup.
Per-call flags `showStatus`, `showStores` and `showFormats` fall back to
`[params.bookkit]` of the same names.

## Optional content hooks

Consumers can inject site-specific blocks without forking templates:

```toml
[params.bookkit]
  bookExtraPartial = "my-book-extra.html"
  chapterBeforeContentPartial = "my-chapter-lead.html"
  chapterActionsPartial = "my-chapter-actions.html"
```

Missing hook partials are silently skipped no-ops: a configured name with
no matching `layouts/partials/<name>.html` never fails the build. The
example site pins nonexistent hook names so CI proves this on every build.

`chapterActionsPartial` renders inside the chapter reader, after its chapter
links, only in `mode = "chapter"` with a current page. It receives a dictionary:
`page` (current Hugo page), `book` (parent book page), `bookSlug` and
`chapterSlug` (last URL segments). Unlike the before-content hook, its context
is not a bare page. The hook requires the reader to be enabled. Unset, missing
or empty partials render no action region; landing pages never invoke it.
BookKit supplies only the `bookkit-reader__actions` container and spacing.
The consumer owns action count, labels, markup, availability, styles and behavior.
For example, the site partial can render a link with `{{ .page.RelPermalink }}`
or resolve resources using `{{ .page.Resources }}`. No JavaScript is required
by the hook itself. CI exercises an actual consumer hook as well as no-op cases.

## Canonical ownership

`bookkit/canonical.html` implements one ownership rule for every section:

```text
page front matter (canonical_url / canonical_self)
    ↓
section native allowlist
    ↓
section policy
    ↓
self
```

Configuration (no consumer domain is hard-coded in templates):

```toml
[params.canonical]
  [params.canonical.sections]
    books = "https://programmer.ie"
    post = "https://programmer.ie"
  [params.canonical.native]
    post = ["my-native-tutorial", "my-native-essay"]
```

Pages whose slug appears in the section native list stay self-canonical;
individual pages can also set `canonical_self = true` or an absolute
`canonical_url` in front matter. Consumers with no `[params.canonical]`
block are fully self-canonical.

Legacy `[params.books] canonicalBase/isCanonicalHost` is still honored for
the book section when the new block is absent.

BookKit can render reader-facing research dossiers for book chapters.
Research **data** comes from the consuming site (for example, Writer's
R19 `PublicResearchDossier` projection); BookKit owns **presentation**
only and never interprets evidence.

### Enable Research

```toml
[params.bookkit.features]
  research = true

[params.bookkit.research]
  dataRoot = "content/research/chapters"
  refreshUI = false
  apiBase = ""
```

Because Hugo modules cannot ship output-format declarations, the
consuming site also declares the Research output once:

```toml
[outputFormats.Research]
  mediaType = "text/html"
  baseName = "research"
  isHTML = true
  permalinkable = true
```

and adds it to chapter pages, typically via cascade in the books
section:

```toml
[cascade]
  outputs = ['HTML', 'Research']
  [cascade.target]
    kind = 'page'
```

### Dossier contract

BookKit reads `programmer.research.chapter.v1` dossiers from
`<dataRoot>/<book>/<chapter>.yaml` and renders the chapter status card
plus a `<chapter>/research.html` page with states `CURRENT`, `STALE`,
`NEVER_RESEARCHED`, and `FAILED_LATEST`, evidence grouped by relation,
tiers shown verbatim, and sources deduplicated by canonical paper ID.

### Static-first behavior

Research pages render fully at build time with no JavaScript and no
live API. When `apiBase` is configured, a small enhancement script may
refresh the status card text; when `refreshUI` is additionally true, a
trusted `mode=auto` refresh button appears.

### Security warning

Do not enable browser refresh against an unprotected public Research
API. `refreshUI` defaults to `false`; enabling it also requires
`apiBase`, otherwise the build warns and renders no control.

### Standalone single-book homepage

A repository containing one primary book can render that book directly at `/` without copying a home layout or creating a root alias:

```toml
[params.bookkit]
  homeBook = "my-book"
```

`homeBook` is resolved below `bookSection` (which defaults to `books`). The same reusable book-page partial renders both `/` and `/books/my-book/`, so the two surfaces stay visually and behaviorally consistent.

Site-local layouts always take precedence over module layouts, so a book or site can override any BookKit template without forking the module.

## What deliberately stays outside BookKit

Programmer.ie branding, navigation, analytics IDs, solution mappings, search configuration, home/about/prompts pages, and book-specific content belong to the consuming site. BookKit should not know which site is using it.

## Migration

See [`docs/migration-from-next-books.md`](docs/migration-from-next-books.md) for the extraction boundary and compatibility notes for `ernanhughes/next-books`.

## Verification

`exampleSite/` is a minimal consumer of the module. CI builds it on every push and pull request so reusable behavior is exercised through the same import mechanism a real book site uses, including the standalone `homeBook` homepage path.

## Compatibility baseline

```text
Bookkit v0.1.0
Consumers:
- programmer.ie (technical-library presentation)
- aibussin.com (applications/solutions presentation)
```

Both consumers pin the same tagged release and build warning-clean with
`hugo --gc --minify --panicOnWarning`. Future releases must verify all
three builds (exampleSite + both consumers) before tagging. The intended
release gate:

```text
Bookkit PR
    ├── exampleSite PASS
    ├── programmer.ie fixture PASS
    └── aibussin.com fixture PASS
             ▼
           release
```
