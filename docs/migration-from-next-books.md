# Migrating `next-books` to Hugo BookKit

This module was extracted from the reusable Hugo publishing behavior in `ernanhughes/next-books`. The goal is to remove copied presentation/runtime code while leaving Programmer.ie-specific behavior in the site repository.

## Move into BookKit

The reusable equivalents now live under namespaced BookKit paths:

| `next-books` responsibility | BookKit replacement |
| --- | --- |
| `layouts/books/section.html` | `layouts/books/section.html` |
| `_default/single.html` book branch | `layouts/books/single.html` |
| `partials/book-reader-nav.html` | `partials/bookkit/book-reader-nav.html` |
| `partials/book-cover*.html` | `partials/bookkit/book-cover*.html` |
| `partials/book-status.html` | `partials/bookkit/book-status.html` |
| `partials/book-store-links.html` | `partials/bookkit/book-store-links.html` |
| `static/css/books.css` + `book-reader.css` | `static/css/bookkit.css` |
| `static/js/book-reader.js` | `static/js/book-reader.js` |
| Mermaid render hook / MathJax bootstrapping | BookKit base + markup hook |

## Keep in `next-books`

Keep Programmer.ie identity and application concerns local: home/about/solutions/prompts/search pages, site navigation, analytics, favicon/avatar, identity CSS, solution-domain mappings, and the actual book content.

## Important behavior changes

### Namespaced configuration

BookKit uses `params.bookkit.*` rather than adding generic site parameters.

### Namespaced templates and CSS

Reusable partials now live under `bookkit/`, and reusable classes use the `bookkit-` prefix. This prevents a consuming site's own `books-*` or `site-*` styles from becoming part of the module contract.

### Neutral progress storage

The old reader used the hard-coded `programmer.ie:book-progress:` localStorage prefix. BookKit defaults to `hugo-bookkit:progress:` and allows the site to override `params.bookkit.storagePrefix`.

To preserve existing Programmer.ie reader progress during migration, configure:

```toml
[params.bookkit]
  storagePrefix = "programmer.ie:book-progress:"
```

This can be changed later with an explicit migration if desired.

### Covers

BookKit resolves covers in this order:

1. `cover` in book front matter.
2. A `cover.*` page resource in the book bundle.
3. `<coverRoot>/<book-slug>/cover.png` in `static/`.

### Store links

The preferred front matter is now a generic list:

```yaml
stores:
  - label: Amazon
    kind: amazon
    url: https://example.com/
  - label: Source
    kind: github
    url: https://github.com/example/book
```

The common legacy `publication.amazon*` and `publication.google*` fields remain readable to make migration incremental.

## Suggested cutover

Import BookKit into `next-books`, preserve the old progress storage prefix, remove the duplicated book partials/CSS/JS one subsystem at a time, and use local site overrides only where Programmer.ie intentionally differs from the generic runtime. Once the site renders equivalently, remove the copied implementations.
