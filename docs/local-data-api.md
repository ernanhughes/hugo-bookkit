# Bookkit Local Data API

The local data platform is a small, native-IndexedDB layer for browser-local
records. It is site-independent: namespaces and payloads belong to the
consuming application.

See `docs/local-data-architecture.md` for the design decisions and data
boundaries.

## Enable the runtime

```toml
[params.bookkit.features]
  localData = true
```

The global feature flag makes the capability available. A page opts in with:

```yaml
bookkit_local_data: true
```

Or through a section cascade. Bookkit's base layout and custom consuming bases
should include the partials explicitly:

```gohtml
{{ partial "bookkit/local-data/head-assets.html" . }}
{{ partial "bookkit/local-data/body-assets.html" . }}
```

Only opt-in pages load `js/bookkit-local/index.js`. The module assigns the
public API to `window.BookkitLocal` and also exposes a default export.

## Open a store

```js
const BookkitLocal = window.BookkitLocal;
const store = await BookkitLocal.open({
  namespace: 'annotations',
  databaseName: 'bookkit-local-v1' // optional
});
```

The database is shared by all namespaces on the page. A store is bound to one
namespace. `open()` is idempotent for the same database/namespace.

## Record envelope

```js
{
  namespace: 'research',
  kind: 'note',
  id: 'note-uuid',
  subjectId: 'retrieval-07-chapter',
  schemaVersion: 1,
  createdAt: '2026-10-25T12:00:00.000Z',
  updatedAt: '2026-10-25T12:05:00.000Z',
  revision: 3,
  payload: { text: 'Investigate this claim.' },
  provenance: { origin: 'reader' }
}
```

- `namespace`, `kind` and `id` are required.
- `subjectId` is optional but recommended for domain records.
- `payload` must be a plain JSON object. Limits: 512 KiB, depth 20, 50,000
  nodes, 200,000 characters per string.
- `provenance` is an optional bounded JSON object.
- Write methods generate `createdAt`, `updatedAt` and `revision`.

## Write and read

```js
const saved = await store.put({
  kind: 'note',
  id: crypto.randomUUID(),
  subjectId: 'chapter-1',
  schemaVersion: 1,
  payload: { text: 'First version' }
});

// Protect against a stale edit from another tab.
const updated = await store.put(
  { ...saved, payload: { text: 'Second version' } },
  { expectedRevision: saved.revision }
);

const record = await store.get('note', saved.id);
const notes = await store.list({
  kind: 'note',
  subjectId: 'chapter-1',
  order: 'desc',
  limit: 50
});
const count = await store.count({ subjectId: 'chapter-1' });
const deleted = await store.delete('note', saved.id, {
  expectedRevision: updated.revision
});
```

- `put()` resolves after the IndexedDB transaction commits.
- `expectedRevision` is optional. When supplied, a mismatch throws
  `ConflictError` with `code === "CONFLICT"` and no write occurs.
- Without `expectedRevision`, `put()` is a last-write-wins upsert.
- `delete()` returns `true` when a record existed.

## Batch and clear

```js
await store.batch([
  { type: 'put', record: recordA },
  { type: 'put', record: recordB },
  { type: 'delete', kind: 'note', id: 'old-note' }
]);

await store.deleteSubject('chapter-1');
await store.clearNamespace();
```

A batch is one transaction. A validation or request failure aborts the whole
batch. `clearNamespace()` touches only the store's namespace.

## Export and import

```js
const data = await store.export({ subjectIds: ['chapter-1'] });
const all = await store.export({});
const markdown = JSON.stringify(data, null, 2);

await store.import(data, { policy: 'merge' });
await store.importFromFile(file, { policy: 'replace' });
```

Policies:

- `merge` — write only when the incoming revision/timestamp is newer.
- `replace` — overwrite existing records.
- `skip` — keep existing records.

Import is atomic. The format is versioned (`bookkit-local-export`, version 1),
checks checksums when present, rejects future format versions, duplicate keys,
malformed timestamps, oversized documents and implicit namespace changes. The
result reports `imported`, `skipped`, `conflicts` and `rejected`.

Application payloads are not understood by the engine, so the consuming
application must validate them before rendering. Programmer.ie does this in its
research schema module.

## Events and other tabs

```js
window.addEventListener('bookkit:local:record-committed', (event) => {
  console.log(event.detail.id, event.detail.revision);
});
```

Event details never contain payloads. Available events:

- `bookkit:local:ready`
- `bookkit:local:record-committed`
- `bookkit:local:record-deleted`
- `bookkit:local:namespace-cleared`
- `bookkit:local:import-completed`
- `bookkit:local:storage-error`
- `bookkit:local:version-blocked`
- `bookkit:local:version-change`
- `bookkit:local:connection-closed`

Notifications are advisory. Re-read IndexedDB to obtain authoritative state.
BroadcastChannel is used when available; its absence does not affect storage.

## Availability and diagnostics

```js
const availability = await BookkitLocal.checkAvailability();
const estimate = await BookkitLocal.getStorageEstimate();
const persisted = await BookkitLocal.isPersisted();
const granted = await BookkitLocal.requestPersistence();
```

`requestPersistence()` is a user-action hint, not a backup guarantee. Offer
export as the recovery path.

## Errors

All API failures use `BookkitLocalError` subclasses with a stable `code`:

| Code | Meaning |
|---|---|
| `STORAGE_UNAVAILABLE` | IndexedDB missing or denied |
| `QUOTA_EXCEEDED` | Browser quota exhausted |
| `UPGRADE_BLOCKED` | Another connection is blocking an upgrade |
| `VERSION_MISMATCH` | This page requested an older schema than the database |
| `CONNECTION_CLOSED` | The database connection was closed (often after a version change) |
| `VALIDATION_ERROR` | A record or import failed validation |
| `CONFLICT` | `expectedRevision` did not match |
| `IMPORT_REJECTED` | An import document was rejected as a whole |
| `TRANSACTION_ABORTED` | The transaction aborted |
| `SCHEMA_INCOMPATIBLE` | Required stores/indexes are missing |

Do not silently downgrade to memory-only storage. Show the failure and offer a
copy/export path.

## Schema upgrades

Current IndexedDB schema: **2**.

- v1 created the generic record store, metadata store and four indexes.
- v2 adds `byNamespaceKindUpdatedAt` and records platform/schema metadata.

Upgrades run in IndexedDB's upgrade transaction. A failure aborts and preserves
the previous version. Existing tabs receive `versionchange`, close their
connection and tell the user to reload. The database is never deleted to avoid
a version conflict.

## Testing

```bash
node tests/records.browser.cjs
node tests/platform.browser.cjs
python -m pytest -q tests
hugo --source exampleSite --gc --minify --panicOnWarning
```

The browser tests use real Chromium IndexedDB. They do not mock the storage
engine.
