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
stores:
  - label: Amazon
    kind: amazon
    url: https://example.com/
---
```

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

  [params.bookkit.features]
    math = true
    mermaid = true
```

Site-local layouts always take precedence over module layouts, so a book or site can override any BookKit template without forking the module.

## What deliberately stays outside BookKit

Programmer.ie branding, navigation, analytics IDs, solution mappings, search configuration, home/about/prompts pages, and book-specific content belong to the consuming site. BookKit should not know which site is using it.

## Migration

See [`docs/migration-from-next-books.md`](docs/migration-from-next-books.md) for the extraction boundary and compatibility notes for `ernanhughes/next-books`.

## Verification

`exampleSite/` is a minimal consumer of the module. CI builds it on every push and pull request so reusable behavior is exercised through the same import mechanism a real book site uses.
