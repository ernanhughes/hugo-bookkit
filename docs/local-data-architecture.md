# Bookkit Local Data Platform — Architecture Decision Record

**Status:** Accepted
**Date:** 2026-10-25
**Workstream:** BK-LD01
**Starting release:** Bookkit v0.4.2 (existing generic platform branch)
**Recommended release:** v0.5.0 (not tagged by this work)

---

## 1. Context and problem

Bookkit needs a reusable browser-local persistence capability, not a one-off
research textarea. Programmer.ie is the first consumer: readers must be able to
write notes, capture sources, record runs and draft proposals, close the page,
and return to the same browser profile with the work intact.

The storage substrate must also fit future Bookkit namespaces such as
`annotations`, `learning`, `language` and `personalisation` without asking each
feature to design its own IndexedDB lifecycle.

The platform must work on a static Hugo site with no account, backend, hosted
database, paid AI provider, telemetry or background execution.

---

## 2. Existing architecture audit

### 2.1 Bookkit JavaScript and assets

- Bookkit is consumed as a Hugo module. Consumers declare one import in
  `hugo.toml`; site-local layouts override module layouts.
- Existing browser code is plain JavaScript under `static/js/` (`book-reader.js`,
  `bookkit-research.js`, `bookkit-search.js`, `bookkit-examples.js`).
- There is no build step and no runtime framework. ES modules are supported by
  every browser that supports the IndexedDB APIs used here.
- Asset inclusion is feature-gated through `layouts/partials/bookkit/...` and
  `[params.bookkit.features]`.
- Programmer.ie uses its own `layouts/_default/baseof.html`; it must include the
  Bookkit asset partials explicitly.

### 2.2 Existing localStorage

`book-reader.js` stores reading progress under
`hugo-bookkit:progress:<bookSlug>`. It is ephemeral, non-critical, and has no
schema. Migrating it now would add risk without user benefit. The platform
therefore leaves reading progress in localStorage and documents a future,
optional one-way import if a concrete need appears.

### 2.3 Module boundaries

Bookkit owns:

- IndexedDB lifecycle, upgrades and connection recovery.
- The generic record envelope, namespaced queries and transactions.
- Export/import format, validation and integrity checks.
- Optional DOM events, BroadcastChannel notifications and diagnostics.
- A small asset partial that loads the runtime only on opt-in pages.

Programmer.ie owns:

- The meaning of notes, sources, runs, proposals and imported reports.
- Chapter identity, freshness comparison and reader-facing warnings.
- Research UI, Markdown export and the external-report import workflow.
- Research-specific records, validation and tests.

The research dossier renderer in Bookkit and Programmer.ie's chapter research
companions remain separate systems. This work does not merge them.

### 2.4 Layout overrides

Programmer.ie does not use Bookkit's base layout. It now includes:

- `bookkit/research/head-assets.html` and `body-assets.html` (existing).
- `bookkit/local-data/head-assets.html` and `body-assets.html` (new).
- Its own `research/workspace.html` presentation partial.

The local-data partials emit nothing unless the site enables
`params.bookkit.features.localData` **and** the current page sets
`bookkit_local_data = true`. A section cascade opts all research companions in.

### 2.5 Versioning and dependency workflow

Bookkit follows Semantic Versioning. Consumers should pin immutable released
versions and run `hugo mod vendor` after upgrading. Hugo prefers `_vendor/`, so
a stale vendor tree can mask a new module. During local cross-repository tests,
use a temporary Go `replace` directive plus:

```bash
hugo --ignoreVendorPaths "github.com/ernanhughes/hugo-bookkit"
```

Do not edit files under `_vendor` as source. This work recommends v0.5.0 because
it adds a storage schema version and new API options; no tag or release is
created without author approval.

---

## 3. Database schema

**Database name:** `bookkit-local-v1` (the platform generation name; the
IndexedDB schema version inside it is independent). Configurable per `open()`.

**Physical schema version:** `2`.

### `records` object store

Key path: `["namespace", "kind", "id"]`

Indexes:

| Index | Key path | Use |
|---|---|---|
| `byNamespaceSubject` | `[namespace, subjectId]` | All records for a chapter / subject |
| `byNamespaceKind` | `[namespace, kind]` | All records of one type |
| `byNamespaceKindSubject` | `[namespace, kind, subjectId]` | Notes for one chapter |
| `byNamespaceUpdatedAt` | `[namespace, updatedAt]` | Recent/all records in a namespace |
| `byNamespaceKindUpdatedAt` | `[namespace, kind, updatedAt]` | Recent runs or imports (v2) |

### `metadata` object store

Key path: `key`. Stores `schemaVersion`, `platformVersion` and the last
migration result. No installation identifier, device fingerprint or usage
telemetry is stored.

### Record envelope

```text
{
  namespace: "research",
  kind: "note",
  id: "9f0c…",
  subjectId: "retrieval-07-chapter",
  schemaVersion: 1,
  createdAt: "2026-10-25T12:00:00.000Z",
  updatedAt: "2026-10-25T12:05:00.000Z",
  revision: 3,
  payload: { ... application meaning ... },
  provenance: { origin: "reader", application: "programmer.ie/research-workspace" }
}
```

- The key is a compound key, so the same `id` can exist in different
  namespaces and the same `id` can exist under different kinds.
- `subjectId` is optional for generic use but required by the research app.
- `revision` starts at 1 and increments on every write.
- `payload` is a bounded JSON object. Non-JSON values, cycles, reserved keys,
  excessive depth and oversized values are rejected.
- Provenance is optional and application-defined. The engine only requires it
  to be a bounded JSON object.
- Timestamps are generated by the write path. Import preserves and validates
  them.

### Generic store vs. separate stores per application

| Concern | One generic `records` store | One object store per application |
|---|---|---|
| New feature kinds | No database migration | New store = new schema version |
| Upgrades | One deterministic migration path | Every feature participates in every upgrade |
| Namespace isolation | Indexed compound key | Physical store boundaries |
| Cross-feature queries | One indexed contract | Requires cross-store coordination |
| Future Language records | Add a namespace/kind | Add a store and migration |
| Risk | A shared envelope must remain general | Strong isolation but repeated migration cost |

**Decision:** one generic store. Namespaces and kinds provide logical
isolation. The platform adds an index only when a real query requires it.

---

## 4. Public JavaScript API

```js
const BookkitLocal = (await import('/js/bookkit-local/index.js')).default;
const store = await BookkitLocal.open({ namespace: 'research' });

const saved = await store.put({
  kind: 'note',
  id: crypto.randomUUID(),
  subjectId: 'retrieval-07-chapter',
  schemaVersion: 1,
  payload: { text: 'Investigate the claim.' }
});

await store.put(
  { ...saved, payload: { text: 'Revised' } },
  { expectedRevision: saved.revision }
);

const notes = await store.list({ kind: 'note', subjectId: 'retrieval-07-chapter' });
const note = await store.get('note', saved.id);
await store.delete('note', saved.id, { expectedRevision: saved.revision });
await store.close();
```

Required operations include get, upsert, batch, delete, delete-subject,
clear-namespace, count, indexed list, export, import, diagnostics and close.
Writes resolve only after `transaction.oncomplete`, not after a request
`onsuccess`.

### Concurrency policy

- Every write increments `revision`.
- Callers editing existing records **should** pass `expectedRevision`.
- A mismatch throws `ConflictError` (`code: "CONFLICT"`) and does not write.
- Omitting `expectedRevision` is a deliberate last-write-wins upsert.
- The research workspace treats a conflict as a draft-preservation event and
  offers “save as new note” rather than overwriting.

### Events

`bookkit:local:ready`, `record-committed`, `record-deleted`,
`namespace-cleared`, `import-completed`, `storage-error`, `version-blocked`,
`version-change` and `connection-closed`.

Events contain IDs, namespace, kind, subject, revision and timestamps. They
never contain record payloads. BroadcastChannel messages carry the same
metadata; IndexedDB remains authoritative.

### Diagnostics and failure handling

- `checkAvailability()` performs a capability check without creating a probe
  database.
- `open()` surfaces `StorageUnavailableError`, `QuotaExceededError`,
  `VersionMismatchError`, `UpgradeBlockedError`, `ConnectionClosedError` and
  transaction errors with stable codes.
- `getDiagnostics()` reports the schema version and, when available,
  `navigator.storage.estimate()` and `persisted()`.
- `requestPersistence()` is an optional user action. Persistence is not a
  backup and is described that way in the UI.
- The UI must never show “Saved” after a failed or uncommitted write. It never
  silently falls back to memory-only storage.

### Version-change and blocked upgrades

- `onversionchange` closes the old connection immediately and emits
  `version-blocked` with reason `version-change`. Old tabs are told to reload.
- `onblocked` emits `version-blocked` with reason `blocked`; the upgrade
  proceeds when the other connection closes.
- Opening an older schema against a newer database is rejected with
  `VERSION_MISMATCH`. The database is never deleted to “fix” it.
- An upgrade runs inside IndexedDB's upgrade transaction. A thrown error aborts
  and rolls back; a failed upgrade leaves the previous version and data intact.

---

## 5. Namespacing and identity

- **Namespace** is the application boundary: `research`, `annotations`,
  `learning`, `language`, etc.
- **Kind** is the record type within the namespace: `note`, `source`, `run`,
  `proposal`, `import`.
- **Subject** is the application's stable domain identity. Programmer.ie uses
  the companion's `research_id` (for example `retrieval-07-chapter`), never the
  current URL, display title or chapter number alone.
- **ID** is a stable client-generated identifier. Arrays are never used as
  identity.
- The research record types map to logical names: `research.note`,
  `research.source`, `research.run`, `research.proposal`,
  `research.imported-report`.

---

## 6. Extension strategy

The extension mechanism is the record contract plus namespaces and kinds, not a
plugin framework.

A future Language consumer could use:

```js
const store = await BookkitLocal.open({ namespace: 'language' });
await store.put({
  kind: 'interaction',
  id: crypto.randomUUID(),
  subjectId: 'session-42',
  schemaVersion: 1,
  payload: {
    role: 'reader',
    text: 'Use shorter explanations.',
    observedAt: '2026-10-25T12:00:00.000Z'
  },
  provenance: { origin: 'reader' }
});
```

That application owns its payload validation and migrations. Bookkit adds no
personality model, embeddings, vector index or agent memory.

Migration support is deliberately small: an ordered set of synchronous schema
steps in `migrations.js`. Applications can add payload migration functions
without changing the database schema. A full plugin registry was rejected as
unnecessary complexity before a second concrete consumer exists.

---

## 7. Export and import

The portable JSON format is:

```json
{
  "format": "bookkit-local-export",
  "version": 1,
  "exportedAt": "2026-10-25T12:00:00.000Z",
  "origin": { "namespace": "research", "application": "bookkit-local" },
  "subjects": ["retrieval-07-chapter"],
  "kinds": ["note", "source", "run", "proposal", "import"],
  "records": [],
  "integrity": { "recordCount": 0, "checksum": "sha256…" }
}
```

- Imports validate format/version, origin namespace, timestamp shape, record
  identity, JSON bounds, duplicate keys and checksum.
- Unsupported format versions are rejected rather than guessed at.
- Namespaces may not be remapped implicitly.
- `merge` (newer revision/timestamp), `replace` and `skip` policies are
  explicit.
- Import is one IndexedDB transaction: either the accepted batch commits or
  none of it does.
- Imported HTML/Markdown is data. The engine never injects it into the DOM.
- Markdown export is a Programmer.ie application feature, not a generic engine
  concern.

Cloud sync is not implemented. The record format is a suitable basis for a
future sync design, but no sync protocol is implied or promised.

---

## 8. Security and privacy boundaries

- No account, backend, telemetry or cloud storage.
- No automatic transmission of reader research to an AI provider.
- No API keys in published JavaScript.
- No `innerHTML` with user-authored or imported content. Programmer.ie renders
  text with `textContent`, validates http/https URLs before creating links and
  treats imported reports as untrusted plain text.
- No private records in Hugo-generated HTML or analytics.
- Clearing research deletes only the `research` namespace.
- A user can export the current chapter, export all reader research, import a
  previous export, clear the current chapter or clear all reader research with
  strong confirmation.
- The platform's event details never contain payloads.
- Storage failures are visible; the public research prompt and downloads remain
  available without JavaScript or IndexedDB.

### Known fingerprint limitation

The chapter fingerprint hashes normalised rendered prose. It does not reliably
detect code-only, image or external-resource changes. The UI says “chapter
prose changed” and never claims complete content integrity. A future extension
can add additional fingerprints without rewriting the current algorithm.

---

## 9. Testing strategy

### Bookkit

- Real Chromium IndexedDB tests in `tests/platform.browser.cjs`,
  `tests/records.browser.cjs` and `tests/upgrade-v0.4.2.browser.cjs` (no mocked
  IndexedDB).
- Included cases: creation, CRUD, commit durability, namespace/subject
  isolation, indexed queries, atomic batches, events, export/import,
  conflicts, invalid/future/duplicate imports, v1→v2 migration with data
  preservation, migration from data created by the actual released v0.4.2
  runtime, failed-upgrade rollback, downgrade rejection, blocked upgrade
  recovery, versionchange closure of a live v0.4.2 connection, optimistic
  concurrency, cross-tab BroadcastChannel, browser-restart persistence with a
  persistent profile, missing IndexedDB and storage diagnostics.
- `python -m pytest -q tests` and the exampleSite Hugo build remain the
  regression gates.

### Programmer.ie

- `tests/research-workspace.browser.cjs` covers real note autosave/persistence,
  page close/reopen, chapter isolation, sources, runs and explicit completion,
  proposal drafts, raw report import, revision warnings with a modified
  fingerprint fixture, export/clear/import, public-history isolation, a fresh
  browser context, XSS/URL safety, malformed and oversized imports, keyboard
  tabs, 320/375/768/1280px layout, unavailable IndexedDB and external-request
  privacy.
- Existing `research-pack.browser.cjs` continues to cover the public prompt,
  downloads, no-JS fallback, heading order, copy fallback and responsive layout.

### Hugo builds

- `hugo --source exampleSite --gc --minify --panicOnWarning` in Bookkit.
- `hugo --gc --minify --panicOnWarning` in Programmer.ie, with the local module
  replace and `--ignoreVendorPaths "github.com/ernanhughes/hugo-bookkit"` during
  cross-repository testing.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A stale `_vendor` tree masks new Bookkit code | Use `--ignoreVendorPaths` locally; release and re-vendor deliberately |
| A browser evicts IndexedDB | Visible status, export, optional persist request, no “backup” claim |
| Multi-tab upgrade blocked forever | Versionchange closes old connections; blocked event tells the user to close/reload |
| Concurrent edits overwrite | Revision checks; conflict UI preserves the draft |
| Imported report contains markup/scripts | Plain-text storage/render, URL allowlist, no HTML injection |
| Payload schema drift | Per-record `schemaVersion`; application validators and documented migration points |
| Prose fingerprint misses non-prose changes | Explicit limitation; future additional fingerprints |
| Large production dependency change unreleased | Local feature branches; no push/tag/deploy; report pending version |

---

## 11. Deferred

- Cross-device sync, accounts, hosted database.
- Vector search, embeddings, semantic index.
- Automated/paid AI inference, background research.
- Service worker or background job engine.
- Migrating reading progress to IndexedDB.
- A plugin registry or generic UI framework.
- Automated parsing of imported AI reports. The raw report is preserved and
  marked unverified; structured extraction is deferred.
