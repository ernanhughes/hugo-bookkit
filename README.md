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
  storagePrefix = "hugo-bookkit:progress:"
  showStatus = true
  showStores = true
  # Optional consuming-site partial hooks:
  # bookExtraPartial = "book-apply-link.html"
  # chapterBeforeContentPartial = "book-visuals.html"

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

## Canonical publication host

Mirrored libraries can declare a canonical publication host without changing
reader navigation. Only pages below the configured book section are rewritten;
ordinary site pages remain self-canonical:

```toml
[params.books]
  canonicalBase = "https://programmer.ie"
  isCanonicalHost = false
```

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
