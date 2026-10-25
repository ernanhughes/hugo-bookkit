/**
 * Bookkit Local Data Platform - deterministic schema migrations.
 *
 * The database is one generic record store, not one store per feature. Version
 * numbers therefore describe the *storage engine*, not a consuming
 * application's payload. Applications version their payloads independently
 * through RecordEnvelope.schemaVersion.
 *
 * v1: records + metadata stores and the four original query indexes.
 * v2: byNamespaceKindUpdatedAt, used for "most recent records of this kind";
 *     platform/schema metadata is written into the metadata store.
 *
 * A migration runs inside IndexedDB's own upgrade transaction. If it throws,
 * the transaction aborts and IndexedDB restores the previous database. The
 * platform never deletes a database to escape a failed upgrade.
 */

export const PLATFORM_VERSION = '2.0.0';
export const DATABASE_VERSION = 2;

export const RECORDS_STORE = 'records';
export const METADATA_STORE = 'metadata';

export const V1_INDEXES = Object.freeze([
  'byNamespaceSubject',
  'byNamespaceKind',
  'byNamespaceKindSubject',
  'byNamespaceUpdatedAt'
]);

export const V2_INDEXES = Object.freeze([
  'byNamespaceKindUpdatedAt'
]);

export const REQUIRED_INDEXES = Object.freeze([...V1_INDEXES, ...V2_INDEXES]);

/**
 * Apply all schema steps required to move an upgrade transaction to
 * `newVersion`.
 */
export function runUpgrade(db, transaction, oldVersion, newVersion) {
  if (newVersion < 1) {
    throw new Error('Bookkit Local Data Platform requires schema version 1 or newer');
  }

  if (oldVersion < 1) {
    const records = db.createObjectStore(RECORDS_STORE, {
      keyPath: ['namespace', 'kind', 'id']
    });

    records.createIndex('byNamespaceSubject', ['namespace', 'subjectId'], { unique: false });
    records.createIndex('byNamespaceKind', ['namespace', 'kind'], { unique: false });
    records.createIndex('byNamespaceKindSubject', ['namespace', 'kind', 'subjectId'], { unique: false });
    records.createIndex('byNamespaceUpdatedAt', ['namespace', 'updatedAt'], { unique: false });

    db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
  }

  if (oldVersion < 2 && newVersion >= 2) {
    const records = transaction.objectStore(RECORDS_STORE);
    if (!records.indexNames.contains('byNamespaceKindUpdatedAt')) {
      records.createIndex(
        'byNamespaceKindUpdatedAt',
        ['namespace', 'kind', 'updatedAt'],
        { unique: false }
      );
    }

    const metadata = transaction.objectStore(METADATA_STORE);
    const migratedAt = new Date().toISOString();
    metadata.put({ key: 'schemaVersion', value: 2, updatedAt: migratedAt });
    metadata.put({ key: 'platformVersion', value: PLATFORM_VERSION, updatedAt: migratedAt });
    metadata.put({ key: 'lastMigration', value: { from: oldVersion, to: newVersion, at: migratedAt } });
  }
}

/**
 * Return the indexes missing from an opened records store.
 * Exposed for diagnostics and for refusing to operate on an incompatible DB.
 */
export function missingIndexes(recordsStore) {
  return REQUIRED_INDEXES.filter((name) => !recordsStore.indexNames.contains(name));
}

/**
 * Read metadata without opening a write transaction.
 */
export function readMetadata(db, keys = []) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(METADATA_STORE, 'readonly');
    const store = transaction.objectStore(METADATA_STORE);
    const values = {};
    let remaining = keys.length;

    if (remaining === 0) {
      resolve(values);
      return;
    }

    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result) values[key] = request.result.value;
        remaining -= 1;
        if (remaining === 0) resolve(values);
      };
      request.onerror = () => reject(request.error);
    }
  });
}
