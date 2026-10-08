# Examples v1 architecture assessment

Inspected 2026-10-08: Bookkit `cc00b04`, programmer.ie importing v0.3.0,
Hugo 0.165.0, and Pi's local examples pinned to 1.0.4.

- Chapter rendering is `layouts/books/single.html`; the reader navigation
  partial already supplies a chapter-actions hook. Book sections use
  `bookkit/book-page.html`. programmer.ie shadows single.html only to use its
  math renderer and has its own base template. Neither needs another override.
- Source paths identify books and chapters. Both `books/b/c.md` and
  `books/b/c/index.md` must map to `examples/b/c/index.md`, irrespective of
  display titles, frontmatter slugs, or deployment prefixes.
- programmer.ie builds a fingerprinted JSON search asset in its search layout.
  Its existing small ranked search script will become a reusable Bookkit asset;
  the same engine and record schema will power example libraries and site search.
- Bookkit owns cached association/discovery, native inline disclosure, Markdown
  rendering and exact source copying, standalone/library layouts, bounded
  search records, book links, and bounded AI context. Site-owned prompt generation
  calls that context helper. Research and Colab link helpers stay untouched.
- programmer.ie owns three Markdown pilots, navigation/configuration, the site
  search adapter, and provenance checks. It will consume the actual local module
  via the documented Go replacement while the shared change is unreleased.
- Pi retains its complete executable project, harness, marker verification,
  declaration checks and tests. No runtime code is moved or duplicated as a new
  product. A reader-facing exact copy is checked against the canonical source;
  educational adaptations are explicitly labelled and linked to their tests.
- No conflict with leaf bundles: Hugo creates the top-level section automatically; a shared content adapter creates book-level sections.
  No per-book registry or `_index.md` is required. Draft inclusion follows Hugo's
  page collection. Existing site edits are preserved; they are not part of this
  implementation's commits.
