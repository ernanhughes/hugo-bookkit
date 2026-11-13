# Changelog

All notable changes to Hugo Bookkit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.6.1] - 2026-11-13

### Fixed
- Chapter links written as `[text]({{< relref ... >}})` no longer receive a
  doubled page prefix. Hugo expands the shortcode after the link render hook,
  so the shared example destination resolver now passes `HAHAHUGOSHORTCODE`
  placeholders through untouched. Ordinary relative, root-relative, fragment
  and resource links are unchanged.
- Regression coverage: `tests/test_chapter_links.py` builds a two-book fixture
  and asserts relref, relative, root and fragment links resolve to the sibling
  chapter, with no doubled prefix, cross-book leak or placeholder leakage.

## [v0.6.0] - 2026-11-09

### Added
- Book reference previews (`ref:` link scheme with static hover/keyboard/touch
  popovers) for books pages:
  - Markdown render hook (`layouts/books/_markup/render-link.html`) that
    enhances only allowlisted `ref:id[#section]` links; ordinary, external
    and resource links render exactly as before.
  - Explicit per-site allowlist (`data/bookkit/references.json`, id to page)
    with graceful plain-text degradation and build warnings for unknown,
    missing, draft, or rejected identifiers (including path traversal).
  - Static build-time preview fragments (explicit `preview` front matter,
    else the page Summary; 80-word budget warns) — no client-side Markdown
    parsing, no `innerHTML`, no remote fetching.
  - Keyboard (focus/Enter/Escape), touch toggle, viewport clamping, and a
    no-JavaScript CSS fallback; feature flagged by
    `[params.bookkit.features] references`.
  - Asset partials (`head-assets`, `body-assets`) wired into the base layout
    behind the flag, following the research/local-data pattern.
- Documentation: `docs/book-reference-previews.md` (architecture, authoring,
  security, accessibility, multi-book rules) plus a README section.
- Tests: `tests/test_references.py` (17 fixture-site build assertions) and
  `tests/references.browser.cjs` manual QA script for interactive behavior
  (Playwright not available in this environment; browser run outstanding).

## [v0.5.0] - 2026-10-25

### Added
- Local Data Platform (`bookkit-local/`) hardening and completion:
  - Native IndexedDB record store with compound `[namespace, kind, id]` keys.
  - Indexed queries, atomic batches, monotonic revisions and optional
    `expectedRevision` conflict checks.
  - Schema v2 with `byNamespaceKindUpdatedAt`, metadata and deterministic
    v1→v2 migration.
  - Versionchange closure, blocked-upgrade events, failed-upgrade rollback and
    explicit `VERSION_MISMATCH` handling without deleting data.
  - Versioned JSON export/import with checksums, bounds, duplicate detection,
    namespace rules and merge/replace/skip policies.
  - Metadata-only DOM events plus BroadcastChannel notifications.
  - Availability, quota, connection, transaction and storage diagnostics.
- Page-level opt-in (`bookkit_local_data = true`) so the runtime is not loaded
  on unrelated pages.
- Real-browser tests: `tests/platform.browser.cjs`, `tests/records.browser.cjs`.
- Released-runtime upgrade test: `tests/upgrade-v0.4.2.browser.cjs` uses the
  frozen v0.4.2 runtime to create real v1 data, then verifies v2 migration,
  downgrade rejection, live-connection closure and stale-write rejection.
- ExampleSite local-data demo with reload persistence.
- API documentation: `docs/local-data-api.md`.

### Changed
- Local-data asset partials now emit an external module and respect the page
  opt-in flag.
- Event payloads never include record data; cross-tab notifications are
  advisory only.
- Removed research-specific Markdown export from the generic portability
  module; research presentation stays in the consuming site.

### Fixed
- All writes now resolve after IndexedDB transaction commit, not request
  success.
- Migration/version handling no longer relies on an unused registration helper.
- Export filtering now honours every requested subject and kind, rather than
  only the first.
- Imports are atomic and reject future format versions, duplicate identities,
  malformed timestamps and unsafe/oversized structures.
- A batch put whose record declares a different namespace is rejected unless
  the operation explicitly supplies the override; it is never silently moved.

### Documentation
- `docs/local-data-architecture.md` — updated architecture decision record.
- `docs/local-data-api.md` — public API and failure contracts.
- Release recommendation only; no tag, push or release is created by this work.

---

## [v0.3.1] - 2026-10-15

### Fixed
- Research dossier: handle missing dossier gracefully
- Chapter actions: preserve action order with Research last
- Mermaid: fix theme initialization in multilingual sites

---

## [v0.3.0] - 2026-09-20

### Added
- Research dossier presentation (R19/R20/R21B)
- Chapter research companions (R22)
- Book reader with reading progress (localStorage)
- Examples library with search

---

## [v0.2.0] - 2026-08-15

### Added
- Multilingual support (en, zh-CN)
- Book catalog and chapter navigation
- Math rendering (MathJax)

---

## [v0.1.0] - 2026-07-01

### Added
- Initial Bookkit module structure
- Base layout, header, footer
- CSS design tokens
- Hugo module configuration