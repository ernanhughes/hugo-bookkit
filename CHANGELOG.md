# Changelog

All notable changes to Hugo Bookkit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Local Data Platform (`bookkit-local/`) — reusable IndexedDB persistence layer
  - `database.js` — DB lifecycle, versioning, availability checks
  - `records.js` — Generic record CRUD, queries, batch operations
  - `migrations.js` — Versioned schema migration framework
  - `events.js` — Cross-tab notifications, storage events
  - `portability.js` — Export/import (JSON + Markdown)
  - `index.js` — Public `BookkitLocal` API
- Asset partials for conditional loading:
  - `layouts/partials/bookkit/local-data/head-assets.html`
  - `layouts/partials/bookkit/local-data/body-assets.html`
- Minimal CSS: `static/css/bookkit-local.css` (status badges)
- Feature flag: `params.bookkit.features.localData`

### Changed
- `layouts/_default/baseof.html` — Include local-data body assets
- `layouts/partials/bookkit/head.html` — Include local-data head assets
- `hugo.toml` — Added baseURL, disableKinds for clean builds

### Documentation
- `docs/local-data-architecture.md` — Architecture decision record
- `scripts/release-bookkit.ps1` — PowerShell release automation

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