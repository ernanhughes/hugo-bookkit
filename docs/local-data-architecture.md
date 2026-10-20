# Bookkit Local Data Platform — Architecture Decision Record

**Status**: Proposed  
**Date**: 2026-10-20  
**Related**: BK-LD01 — Bookkit Local Data Platform and Programmer.ie Research Workspace

---

## 1. Context and Problem Statement

We need a reusable, versioned browser-local persistence platform using IndexedDB in Hugo Bookkit. The first application is a persistent research workspace on Programmer.ie where visitors can create notes, capture sources, record findings, and have their work survive browser restarts.

The platform must:
- Be site-independent (Bookkit owns the storage engine)
- Support multiple namespaces (research, annotations, learning, language, etc.)
- Handle schema versioning and migration
- Work on statically hosted Hugo sites
- Not require user accounts or network services
- Provide clear privacy boundaries

---

## 2. Existing Architecture Analysis

### 2.1 Bookkit JavaScript Architecture
- ES modules loaded via `<script defer>` in base layout
- Feature-gated loading through `params.bookkit.features` config
- Existing modules: `book-reader.js` (localStorage), `bookkit-research.js` (API-enhanced), `bookkit-search.js`, `bookkit-examples.js`
- Asset partials: `head-assets.html`, `body-assets.html` for conditional inclusion
- Custom CSS/JS injection via `params.bookkit.customCSS` / `params.bookkit.customJS`

### 2.2 Existing localStorage Use
- `book-reader.js` stores reading progress per book slug under `hugo-bookkit:progress:{bookSlug}`
- Simple key-value, no versioning, no migration
- No migration necessary — reading progress is ephemeral and non-critical

### 2.3 Hugo Module Boundaries
- Bookkit is consumed as a Hugo module (`github.com/ernanhughes/hugo-bookkit`)
- Programmer.ie pins `v0.3.1` in `go.mod`
- Vendor directory (`_vendor`) takes precedence; must avoid editing vendored files
- Local development uses `replace` directive in `go.mod`

### 2.4 Site-Specific Layout Overrides
- Programmer.ie uses its own `layouts/_default/baseof.html`
- Includes Bookkit partials explicitly: `bookkit/research/head-assets.html`, `bookkit/research/body-assets.html`
- Bookkit's base layout is not used by Programmer.ie

### 2.5 Module Dependency/Versioning Workflow
1. Develop in local `hugo-bookkit` repo
2. Test against `exampleSite` and via `replace` in Programmer.ie
3. Tag release in Bookkit
4. Update `go.mod` in Programmer.ie to new version
5. Run `hugo mod vendor` to update `_vendor`

### 2.6 IndexedDB Browser Support
- Supported in all modern browsers (Chrome, Firefox, Safari, Edge)
- Private browsing: may restrict or disable IndexedDB (Safari private mode)
- Quota: varies by browser/origin; `navigator.storage.estimate()` available
- Failure modes: `SecurityError`, `QuotaExceededError`, `UnknownError`, blocked upgrades

---

## 3. Database Schema Design

### 3.1 Database Name
`bookkit-local-v1` (configurable via `params.bookkit.localData.databaseName`)

### 3.2 Object Stores

#### `records` — Primary record store
```
Key: [namespace, kind, id] (compound key)
Indexes:
  - byNamespaceSubject: [namespace, subjectId]
  - byNamespaceKind: [namespace, kind]
  - byNamespaceKindSubject: [namespace, kind, subjectId]
  - byNamespaceUpdatedAt: [namespace, updatedAt]
```

#### `metadata` — Platform metadata
```
Key: string (e.g., "platformVersion", "installationId")
Value: any
```

### 3.3 Record Envelope
```typescript
interface RecordEnvelope<T = unknown> {
  namespace: string;        // e.g., "research"
  kind: string;             // e.g., "note", "source", "run", "proposal"
  id: string;               // stable UUID
  subjectId: string;        // e.g., "retrieval-07-chapter"
  schemaVersion: number;    // payload schema version
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
  payload: T;               // application-specific data
  provenance?: Provenance;  // optional metadata
  revision?: number;        // optimistic concurrency
}
```

### 3.4 Design Rationale: Generic Record Store vs. Per-Application Stores

**Chosen: Generic record store with compound key and indexes**

| Factor | Generic Store | Per-App Stores |
|--------|---------------|----------------|
| Migration cost | One migration for all apps | Migration per app store |
| Schema evolution | Add indexes as needed | New stores = new migrations |
| Namespace isolation | Index-based | Native |
| Query flexibility | Rich compound indexes | Limited to store design |
| Future-proofing | New kinds = no schema change | New store = migration |

The generic design minimizes repeated database migrations when new application features are introduced. New record kinds (e.g., `language.interaction`) require only index updates, not new object stores.

---

## 4. Public JavaScript API

```typescript
// Entry point
const store = await BookkitLocal.open({
  namespace: "research",
  databaseName?: string,  // optional override
});

// CRUD
await store.get(kind: string, id: string): Promise<RecordEnvelope | null>;
await store.put(record: Omit<RecordEnvelope, "createdAt" | "updatedAt" | "revision">): Promise<RecordEnvelope>;
await store.delete(kind: string, id: string): Promise<void>;

// Query
await store.list(options: {
  kind?: string;
  subjectId?: string;
  since?: string;  // updatedAt ISO string
  limit?: number;
}): Promise<RecordEnvelope[]>;

// Batch
await store.batch(operations: Array<{ type: "put" | "delete", record?: ..., kind?: ..., id?: ... }>): Promise<void>;

// Capability
await BookkitLocal.checkAvailability(): Promise<{ available: boolean; reason?: string; estimate?: StorageEstimate }>;

// Portability
await store.export(options: { kinds?: string[]; subjectIds?: string[] }): Promise<ExportFormat>;
await store.import(data: ExportFormat, policy: "merge" | "replace" | "skip"): Promise<ImportResult>;

// Lifecycle
await store.close(): Promise<void>;
```

### 4.1 Transaction Guarantees
- All write operations resolve only after IndexedDB transaction commits
- `onsuccess` on request ≠ committed; use `transaction.oncomplete`
- Errors are thrown, never swallowed

### 4.2 Events
```typescript
// Dispatched on window
bookkit:local:ready                    // { namespace }
bookkit:local:record-committed         // { namespace, kind, id, subjectId }
bookkit:local:record-deleted           // { namespace, kind, id, subjectId }
bookkit:local:storage-error            // { namespace, error, operation }
bookkit:local:version-blocked          // { namespace, oldVersion, newVersion }
```
- Payloads contain IDs and metadata only, never full record content
- Listeners are optional; storage layer has no dependency on consumers

---

## 5. Namespacing and Identity

- **Namespace**: Top-level separation (e.g., `research`, `annotations`, `learning`, `language`)
- **SubjectId**: Stable chapter identifier (`research_id` from companion, e.g., `retrieval-07-chapter`)
- **Kind**: Record type within namespace (e.g., `note`, `source`, `run`, `proposal`, `claim`, `finding`)
- **Id**: UUID v4 generated client-side

This allows multiple applications to coexist without collision and enables cross-subject queries within a namespace.

---

## 6. Extension Strategy

### 6.1 Future Application Namespaces
The platform accepts any namespace string. Future features register their kinds:
```typescript
// In application code (Programmer.ie or future Language work)
const RESEARCH_KINDS = ["note", "source", "run", "proposal", "claim", "finding"] as const;
```

### 6.2 Schema Versioning per Kind
- Each `kind` carries its own `schemaVersion`
- Migration functions registered per kind
- Platform provides migration runner; apps provide transformers

### 6.3 AI Adapter Contract (Future)
```typescript
interface ResearchAssistant {
  run(task: "analyse-claims" | "extract-sources" | "draft-proposal", input: {
    chapterContext: ChapterContext;
    sources: Source[];
    notes: Note[];
    permissions: Permissions;
  }): Promise<AssistantResult>;
}
```
Not implemented in this milestone; documented for future compatibility.

---

## 7. Export/Import Format

```json
{
  "format": "bookkit-local-export",
  "version": 1,
  "exportedAt": "2026-10-20T12:00:00Z",
  "origin": { "namespace": "research", "application": "programmer.ie" },
  "subjects": ["retrieval-07-chapter"],
  "kinds": ["note", "source", "run", "proposal"],
  "records": [
    { "namespace": "research", "kind": "note", "id": "...", "subjectId": "...", "schemaVersion": 1, "createdAt": "...", "updatedAt": "...", "payload": {...} }
  ],
  "integrity": { "recordCount": 42, "checksum": "sha256..." }
}
```

- Import validates format, version, bounds
- Rejects unsupported/dangerous structures
- Conflict policy: merge (newer wins), replace, skip
- Atomic batch import

---

## 8. Security and Privacy Boundaries

- No user accounts, no backend, no cloud sync
- No automatic AI transmission; explicit user action required
- No API keys in published JS
- No `innerHTML` with untrusted content — `textContent` only
- URL validation before making clickable
- Imported JSON/Markdown treated as untrusted
- Export as backup mechanism
- Clear chapter research without affecting other namespaces
- Storage failures visible to user

---

## 9. Testing Strategy

### 9.1 Bookkit Unit & Browser Tests
- Database creation, versioned schema
- CRUD, namespace/subject isolation, indexed queries
- Atomic transactions, failure handling, reopen persistence
- Migration v1→v2 with data preservation
- Multi-tab upgrade blocking, versionchange handling
- Concurrent update policy (optimistic revision)
- Export/import, conflict handling, invalid rejection
- Missing IndexedDB, quota errors, event notification

### 9.2 Programmer.ie Integration Tests (Playwright)
- Open chapter 7 → add note → save → reload → note restored
- Chapter isolation: notes don't leak across chapters
- Export/import round-trip
- Revision warning when fingerprint changes
- No-JS fallback works

### 9.3 Hugo Build Tests
- `hugo --gc --minify --panicOnWarning` in both repos
- Bookkit `exampleSite` build
- Programmer.ie build

---

## 10. Deferred Functionality

- Cloud sync / cross-device
- Service worker background sync
- Vector search / embeddings
- AI personality / agent memory
- Automatic research execution
- Reading progress migration to IndexedDB (documented path only)

---

## 11. Implementation Plan

### BK-LD01A — Architecture and Baseline (this document)
- Repository audit ✓
- Architecture decision record ✓
- Current test results
- Proposed generic data API
- Schema design
- Integration plan
- Risk register

### BK-LD01B — Reusable IndexedDB Platform (Bookkit)
- `static/js/bookkit-local/database.js` — DB lifecycle, migrations
- `static/js/bookkit-local/records.js` — Record envelope, CRUD, queries
- `static/js/bookkit-local/migrations.js` — Migration runner, v1→v2 test
- `static/js/bookkit-local/events.js` — Event dispatcher
- `static/js/bookkit-local/portability.js` — Export/import
- `static/js/bookkit-local/index.js` — Public API export
- `layouts/partials/bookkit/local-data/head-assets.html` — Conditional CSS
- `layouts/partials/bookkit/local-data/body-assets.html` — Conditional JS
- Tests: browser tests for all above

### BK-LD01C — Research Workspace Integration (Programmer.ie)
- Add "My Research Workspace" section to `pack.html`
- `static/js/research-workspace.js` — UI logic using BookkitLocal API
- `static/css/research-workspace.css` — Scoped styles
- Notes, sources, runs, proposals with autosave
- Chapter revision detection and warnings
- Export/import UI

### BK-LD01D — Research Import and AI Extension Boundary
- Import AI research workflow (paste/import report)
- Documented AI adapter contract
- Provenance handling

### BK-LD01E — Verification and Release Handoff
- All tests passing
- Hugo builds clean
- Cross-repo integration report
- Local commits, version recommendation
- Final report