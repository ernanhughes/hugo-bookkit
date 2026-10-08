# Examples v1

Create one file to add a chapter example:

```text
content/examples/{book-directory}/{chapter-file-stem}/index.md
```

For `content/books/alpha/01-chapter.md` or
`content/books/alpha/01-chapter/index.md`, use
`content/examples/alpha/01-chapter/index.md`. The file name is the association;
changing a title, frontmatter slug or baseURL does not change it. Do not use an
absolute URL, title-derived slug or manual registry as the association.

## A complete minimal example

Create `content/examples/alpha/01-chapter/index.md`:

````markdown
+++
title = "Calculate the retry budget"
description = "See the maximum number of attempts before adopting a retry policy."
weight = 1
tags = ["retry", "budget"]
draft = false
+++

You can run this calculation with Python 3. Save it as `budget.py`.

## Implementation

```python
requests = 3
retries_per_request = 2
print(requests * (1 + retries_per_request))
```

## Expected outcome

```text
9
```

## Mechanism and limitations

Each request may have one initial attempt and two retries. This is a proposed
budget calculation, not a measurement of a real service. Verify the retry
policy against your actual client before adopting it.
````

Only `title` is needed by the layouts; ordinary Hugo optional fields such as
description, weight, tags and draft are useful. Keep the content type inferred
as `examples`. Use Markdown headings for the mechanism, setup, complete code,
expected outcome and limitations. Do not include tokens, credentials or machine
configuration in output examples. Label expected output honestly; a transcript
is observed evidence only when the implementation was actually run.

## What happens automatically

The chapter displays a native **Example** disclosure near its actions. It works
without JavaScript; JavaScript adds Escape/close focus restoration and exact
code copying. No example means no action or empty panel. The same page renders
at `/examples/alpha/01-chapter/`, links back to the real chapter URL, and appears
in `/examples/alpha/` and `/examples/`. Book landing pages display **Browse
Examples** only when the published collection contains examples for that book.
The default Bookkit header also adds Examples when needed.

Hugo automatically creates the top-level section. Bookkit's
`content/examples/_content.gotmpl` content adapter supplies intermediate
book-level section pages, so authors need not create `_index.md` files. An
optional `content/examples/alpha/_index.md` can customize that landing page;
the adapter skips it to avoid a collision. This v1 adapter inspects the standard
`content/examples` directory. Nonstandard content mounts/language directories
need an equivalent adapter pointing at their content root. It makes no network
requests and introduces no publishing service.

Drafts follow Hugo's build mode: excluded normally and included with
`--buildDrafts`. An orphan remains available in its library with a build warning;
it has no invented chapter backlink or chapter AI context. Duplicate identities
are a build error. Run `hugo --printPathWarnings` to catch URL collisions too.

## Search

The library reuses the ranked search engine migrated from programmer.ie as
`js/bookkit-search.js`; there is no second example search algorithm. Both the
global and per-book libraries publish fingerprinted JSON assets, fetched only
on library pages. Each record contains the Example type, book/chapter metadata,
URLs, tags, a description of at most 200 characters, and at most **120 unique
source terms** extracted from the first 20,000 source characters. Each indexed
term is at most 64 characters. Full rendered
HTML and full code are never stored in the index. Put important late identifiers
in tags when the term budget would exclude them. V1 indexes case-insensitive
alphanumeric/underscore/plus/hash terms; it is discovery search, not literal
substring search over every byte of source code.

The module caches discovery and the shared records once per language/build.
Per-book libraries load only that book's compact records. Global search remains
linear in the compact collection and fetches the global index; it is not a
benchmark-proven solution for tens of thousands of examples. Measure the audit's
index size at scale, and consider book shards for the global UI before that
size becomes unsuitable. Result rendering is capped at 80 rows per page, with
previous/next controls for libraries. Without JavaScript, native Hugo pagination
provides the same 80-page-size browsing through links. A chapter contains only
its matching example, never another chapter's implementation payload.

Existing search integrations append shared records once:

```go-html-template
{{ $records = $records | append (partialCached "bookkit/examples/search-records.html" . .Site.Language.Lang) }}
```

Use the existing record schema and add an Example type filter and optional
`data-search-book` select whose option values are book directories. The shared
script accepts existing `data-site-search` markup; `data-search-browse` enables
listing results with an empty query. No author maintains the search index.

## Understand and Apply

Standalone pages supply copyable Understand/Apply prompts. Existing chapter
prompt systems append this generic helper to their existing prompt body:

```go-html-template
{{ partial "bookkit/examples/prompt-context.html" (dict "page" $chapter "action" "apply") }}
```

Use `understand` for explanation. The helper returns empty text when no example
exists, preserving existing fallback behaviour. It supplies actual chapter and
example URLs, complete raw Markdown up to 12,000 UTF-8 bytes, adaptation or
explanation guidance, and an explicit localhost/private-preview fallback.
If the source is larger, it omits it **in full**, explains the omission and asks
for relevant complete blocks. It never truncates a code block silently or puts
an entire implementation in a query string. The budget applies to the example
addition; a consumer remains responsible for its pre-existing prompt's size.
Research and Colab keep their existing link generation.

## Styling, copying and safety

Bookkit's default base loads `css/bookkit-examples.css` and
`js/bookkit-examples.js`. Sites with their own base template include those shared
assets once, and load `js/bookkit-search.js` on search/library pages (or in an
existing lightweight global asset list). No site-level example layout override
is needed. Keep the normal Bookkit chapter navigation partial in custom chapter
layouts to retain the automatic action.

Example-only render hooks retain the original fence body in an escaped hidden
textarea, independently of highlighted HTML. Copying includes the entire block,
without line numbers, buttons or syntax tokens. Clipboard refusal exposes and
selects the source for manual copying. Platform clipboards may normalize line
endings. Buttons provide screen-reader status feedback. Code and tables scroll
inside the example at narrow widths.

Normal Hugo Markdown safety configuration still applies. The feature does not
enable raw HTML or inject Markdown via JavaScript `innerHTML`. For untrusted
author content set `markup.goldmark.renderer.unsafe = false`; a site deliberately
setting it true is trusting raw HTML throughout its Markdown, including examples.
Relative page/resource links use example render hooks to resolve against the
example page, so inline content and standalone content share the same targets.

## Source provenance and auditing

Keep canonical tests and runnable source in their owning repository. Copy exact
source only with a relationship a check can validate; label educational
adaptations and record the tests/docs that support their claims. Hugo has no
knowledge of an external source checkout, so source verification is an explicit
release check, not an implicit claim that every fence was executed during a build.

The programmer.ie pilots use `scripts/verify_example_provenance.py --pi-root
../pi`. `pi-copy` comments compare code against canonical files;
`pi-source` comments pin normalized-text SHA-256 digests for tests/docs. A changed
digest requires re-reading the claims, not blindly refreshing the hash. No second
runtime implementation or dependency directory is published.

After a build, run the non-destructive shared audit:

```bash
python ../hugo-bookkit/scripts/audit_examples.py public
# For a deployment under /library/:
python ../hugo-bookkit/scripts/audit_examples.py public --base-path /library/
```

It reports book/example counts, orphans, duplicate identities/URLs, broken
references, index bytes, pages over 256 KB and suspicious published executable
or dependency assets. Review supporting images before placing them in leaf
bundles; Hugo can publish resources when templates reference them. Do not copy
tests, node_modules or build artifacts into `content/examples` or `static`.

## Troubleshooting

- Missing action: check exact source directory/stem, draft/date eligibility,
  reader navigation, and the imported module revision. Never infer success from
  a local file if the consuming site still imports an older module.
- Missing book library: confirm the module's content adapter is mounted and
  `content/examples` is the active source root. Remove an obsolete site override.
- Missing search term: use tags or description for essential identifiers beyond
  the 120-term extraction budget; rebuild the fingerprinted index.
- Wrong source copy: run the provenance check, then reconcile against the pinned
  canonical source. Do not change the published code just to silence a mismatch.
- Diagram in an inline example: Bookkit propagates the Mermaid asset flag to
  the chapter; enable its existing Mermaid feature as usual.

The same convention applies to the next book and the hundredth. Book names,
URLs and chapter numbers are not hardcoded in the shared module.
