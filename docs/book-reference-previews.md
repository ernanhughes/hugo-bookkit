# Book Reference Previews

Hover- and keyboard-accessible previews for approved Markdown references.
A reader encountering `[ADR 0001 — …](ref:adr-0001)` sees a short formatted
excerpt without leaving the chapter; clicking opens the full document.

## Authoring

Link to an approved reference with the `ref:` scheme plus an optional
`#section` fragment:

```markdown
The design is documented in [ADR 0001 — Evidence-first claim contracts](ref:adr-0001).
```

```markdown
See the [decision section](ref:adr-0001#decision) for the rationale.
```

Only the id namespace `ref:` is intercepted, and only on `books` pages.
Every other link — ordinary relative links, external URLs, anchors,
resources — renders exactly as before.

## Admission

References are allowlisted per site in `data/bookkit/references.json`:

```json
{
  "adr-0001": {
    "page": "references/decisions/0001-evidence-first-claim-contract",
    "kind": "architecture-decision"
  }
}
```

Only listed ids get previews. Unknown ids, missing pages, draft pages
(in non-draft builds) and malformed ids (`..`, `/`, uppercase, spaces)
render as plain text plus a build warning — never a fabricated link and
never an unsafe `href`.

The manifest maps an id to exactly one page under the site's control.
`page` paths containing `..` are rejected before lookup. External URLs
can never receive previews.

## Preview content

Each preview shows, in order: the target title, the kind and optional
`status` front matter, a bounded excerpt, an optional section label, and
a "Read the full document" link.

The excerpt prefers an explicit `preview` front-matter field, else the
page `Summary`. Both are rendered by Hugo at build time from the
approved source page — nothing is invented, no client-side Markdown
parsing runs, and no raw author string is injected into the DOM.

Keep explicit previews under ~80 words; longer ones still render but
emit a build warning. Do not paste whole documents into previews.

## Full document

The projection page (e.g. `content/references/decisions/….md`) is an
ordinary Hugo page rendered by the consuming site's layouts. Clicking
the preview title or the "Read the full document" link opens it.
The canonical source stays where it belongs (for example
`docs/decisions/` in the owning repository); the projection records
its source path and revision in front matter and must never be edited
independently — see "Math pilot" below for the drift check.

## Configuration

```toml
[params.bookkit.features]
  references = true
```

When disabled (the default), `ref:` links render verbatim, no preview
markup, CSS, or JavaScript is emitted, and ordinary links are
unaffected. A per-page opt-out is not needed: unlisted ids never
activate. To suppress previews on one page, link to the page normally.

Assets are wired through partials so consuming sites with custom base
layouts can include them explicitly:

```gohtml
{{ partial "bookkit/references/head-assets.html" . }}   {{/* in <head> */}}
{{ partial "bookkit/references/body-assets.html" . }}   {{/* before </body> */}}
```

Bookkit's own base layout already includes both, gated on the flag.

## Interaction

- Mouse: hovering the link (or moving into the open preview) reveals it;
  leaving the component dismisses it. No timers, no flicker: the preview
  is adjacent to the link inside one hover region.
- Keyboard: tab to the link to reveal; `Enter` follows it; `Escape`
  dismisses and returns focus to the link.
- Touch: a small disclosure button appears on coarse pointers; it toggles
  the preview without hijacking the title link, which always navigates.
- Viewport: the popover flips alignment when it would overflow the right
  edge and becomes a static block on narrow screens.
- Motion: no transitions, so `prefers-reduced-motion` needs no override.

Without JavaScript, CSS `:hover`/`:focus-within` still reveals the
preview and the link still navigates. The toggle button needs
JavaScript; the link never does.

## Accessibility

The preview container has `role="note"` and a unique id; the link
references it with `aria-describedby` and the toggle with
`aria-controls`/`aria-expanded`. The disclosure button exposes its state.
Link text remains a real navigable link independent of dismissal state.
Preview copy is bounded and scrollable.

## Security

- Allowlist-only activation; arbitrary local files cannot be exposed.
- `..` and `/` in ids are rejected; `..` in manifest page paths is rejected.
- Preview HTML is Goldmark-rendered source under the site's markup policy
  (unsafe HTML is escaped by default, as in the rest of the site).
- No `innerHTML`, no runtime Markdown parsing, no fetched content.
- Same-site documents only; external URLs never get previews.

## Math pilot (first consumer)

The Math repository owns the canonical decision at
`docs/decisions/0001-evidence-first-claim-contract.md` and publishes an
explicit projection at `content/references/decisions/…` with
`source_path`, `source_sha256`, and `source_commit` front matter.
`docs/references/manifest.json` declares the eligible ids.
`scripts/validate_book_references.py` fails the build if the projection
drifts from canonical, if a chapter links an unknown id, or if a
protected evidence file changed. Chapter 1 links the ADR with
`[ADR 0001 — Evidence-first, versioned claim contracts](ref:adr-0001)`.

## Multi-book rules

- Reference ids live in one site-wide namespace; prefix them per book
  (`<book>-<slug>`) so two books never collide.
- A missing page degrades to text, never to another book's document.
- Cross-book references are not resolved: each book's manifest lists only
  its own pages. Shared documents get one id and one canonical page.
- Renaming a target path requires updating the manifest in the same
  change; the build warns (not fails) on drift so authors notice.

## Limitations

- Section anchors (`ref:id#section`) link to the section but preview the
  page; section-scoped previews are a future enhancement.
- The books-section render hook does not apply outside `books` pages;
  extending coverage means adding the hook to `_default/_markup`.
- Interactive behavior (hover intent, focus, Escape, touch) is covered by
  `tests/references.browser.cjs` manual QA; Playwright is not installed
  in this environment, so only static/DOM assertions run in CI here.
