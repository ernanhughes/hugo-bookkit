# Changelog

All notable changes to Hugo Bookkit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased — recommended v0.5.0]

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