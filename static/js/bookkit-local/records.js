/**
 * Bookkit Local Data Platform — Record Operations
 *
 * Provides CRUD and query operations on the generic record store.
 * All write operations resolve only after the IndexedDB transaction commits.
 */
import type { DatabaseError } from './database.js';

export interface RecordEnvelope<T = unknown> {
  namespace: string;
  kind: string;
  id: string;
  subjectId: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  payload: T;
  provenance?: Provenance;
  revision?: number;
}

export interface Provenance {
  source: 'reader' | 'import' | 'ai-suggested' | 'external' | 'author-reviewed';
  tool?: string;
  importedAt?: string;
  originalId?: string;
}

export interface ListOptions {
  kind?: string;
  subjectId?: string;
  since?: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

export interface BatchOperation {
  type: 'put' | 'delete';
  record?: Omit<RecordEnvelope, 'createdAt' | 'updatedAt' | 'revision'>;
  kind?: string;
  id?: string;
  namespace?: string;
}

export interface StoreConfig {
  namespace: string;
  databaseName?: string;
  version?: number;
}

interface OpenStoreResult {
  db: IDBDatabase;
  namespace: string;
  close: () => void;
}

/**
 * Generate a UUID v4.
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get current ISO timestamp.
 */
function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Wrap an IDBRequest in a promise that resolves on transaction commit.
 */
function awaitTransaction(request: IDBRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    const transaction = request.transaction!;
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
  });
}

/**
 * Open a namespaced store.
 */
export async function openStore(config: StoreConfig): Promise<OpenStoreResult> {
  const { openDatabase } = await import('./database.js');
  const dbName = config.databaseName || 'bookkit-local-v1';
  const version = config.version || 1;

  const { db } = await openDatabase({
    name: dbName,
    version,
    onUpgrade: (db, oldVersion, newVersion) => {
      // Migrations handled separately
    }
  });

  return {
    db,
    namespace: config.namespace,
    close: () => db.close()
  };
}

/**
 * Create a record envelope with metadata.
 */
export function createRecord<T>(
  namespace: string,
  kind: string,
  subjectId: string,
  payload: T,
  options: { id?: string; schemaVersion?: number; provenance?: Provenance } = {}
): RecordEnvelope<T> {
  const timestamp = nowISO();
  return {
    namespace,
    kind,
    id: options.id || generateId(),
    subjectId,
    schemaVersion: options.schemaVersion || 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    payload,
    provenance: options.provenance,
    revision: 0
  };
}

/**
 * Get a single record by kind and id.
 */
export async function getRecord<T = unknown>(
  store: OpenStoreResult,
  kind: string,
  id: string
): Promise<RecordEnvelope<T> | null> {
  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readonly');
    const objectStore = tx.objectStore('records');
    const request = objectStore.get([store.namespace, kind, id]);

    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? (result as RecordEnvelope<T>) : null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Put (upsert) a record. Resolves with the committed record including revision.
 */
export async function putRecord<T>(
  store: OpenStoreResult,
  record: Omit<RecordEnvelope<T>, 'createdAt' | 'updatedAt' | 'revision'>
): Promise<RecordEnvelope<T>> {
  const namespace = store.namespace;
  const now = nowISO();

  // Check if record exists to preserve createdAt and increment revision
  const existing = await getRecord(store, record.kind, record.id);

  const toStore: RecordEnvelope<T> = {
    ...record,
    namespace,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    revision: (existing?.revision || 0) + 1
  } as RecordEnvelope<T>;

  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readwrite');
    const objectStore = tx.objectStore('records');
    const request = objectStore.put(toStore);

    request.onsuccess = () => {
      // Resolve only after transaction commits
      tx.oncomplete = () => {
        // Dispatch event
        window.dispatchEvent(new CustomEvent('bookkit:local:record-committed', {
          detail: { namespace, kind: record.kind, id: record.id, subjectId: record.subjectId }
        }));
        resolve(toStore);
      };
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete a record by kind and id.
 */
export async function deleteRecord(
  store: OpenStoreResult,
  kind: string,
  id: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readwrite');
    const objectStore = tx.objectStore('records');
    const request = objectStore.delete([store.namespace, kind, id]);

    request.onsuccess = () => {
      tx.oncomplete = () => {
        window.dispatchEvent(new CustomEvent('bookkit:local:record-deleted', {
          detail: { namespace: store.namespace, kind, id }
        }));
        resolve();
      };
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * List records with filtering options.
 */
export async function listRecords<T = unknown>(
  store: OpenStoreResult,
  options: ListOptions = {}
): Promise<RecordEnvelope<T>[]> {
  const { kind, subjectId, since, limit = 1000, offset = 0, order = 'desc' } = options;

  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readonly');
    const objectStore = tx.objectStore('records');

    let index: IDBIndex;
    let range: IDBKeyRange | undefined;

    if (kind && subjectId) {
      index = objectStore.index('byNamespaceKindSubject');
      range = IDBKeyRange.bound(
        [store.namespace, kind, subjectId, ''],
        [store.namespace, kind, subjectId, '\uffff']
      );
    } else if (kind) {
      index = objectStore.index('byNamespaceKind');
      range = IDBKeyRange.bound(
        [store.namespace, kind, ''],
        [store.namespace, kind, '\uffff']
      );
    } else if (subjectId) {
      index = objectStore.index('byNamespaceSubject');
      range = IDBKeyRange.bound(
        [store.namespace, subjectId, ''],
        [store.namespace, subjectId, '\uffff']
      );
    } else {
      index = objectStore.index('byNamespaceUpdatedAt');
      range = IDBKeyRange.bound(
        [store.namespace, ''],
        [store.namespace, '\uffff']
      );
    }

    const direction = order === 'asc' ? 'next' : 'prev';
    const request = index.openCursor(range, direction);

    const results: RecordEnvelope<T>[] = [];
    let skipped = 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const record = cursor.value as RecordEnvelope<T>;

        // Filter by since (updatedAt)
        if (since && record.updatedAt < since) {
          cursor.continue();
          return;
        }

        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }

        if (results.length < limit) {
          results.push(record);
          cursor.continue();
        }
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Execute multiple operations in a single transaction.
 */
export async function batchRecords(
  store: OpenStoreResult,
  operations: BatchOperation[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readwrite');
    const objectStore = tx.objectStore('records');

    let completed = 0;
    let hasError = false;

    const checkComplete = () => {
      completed++;
      if (completed === operations.length && !hasError) {
        // Wait for transaction commit
        tx.oncomplete = () => {
          // Dispatch events for each put/delete
          for (const op of operations) {
            if (op.type === 'put' && op.record) {
              window.dispatchEvent(new CustomEvent('bookkit:local:record-committed', {
                detail: {
                  namespace: op.namespace || store.namespace,
                  kind: op.record.kind,
                  id: op.record.id,
                  subjectId: op.record.subjectId
                }
              }));
            } else if (op.type === 'delete') {
              window.dispatchEvent(new CustomEvent('bookkit:local:record-deleted', {
                detail: {
                  namespace: op.namespace || store.namespace,
                  kind: op.kind,
                  id: op.id
                }
              }));
            }
          }
          resolve();
        };
      }
    };

    for (const op of operations) {
      if (hasError) break;

      if (op.type === 'put' && op.record) {
        const namespace = op.namespace || store.namespace;
        const now = nowISO();
        const existing = await getRecord(store, op.record.kind, op.record.id);

        const toStore: RecordEnvelope = {
          ...op.record,
          namespace,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          revision: (existing?.revision || 0) + 1
        };

        const request = objectStore.put(toStore);
        request.onerror = () => {
          hasError = true;
          reject(request.error);
        };
        request.onsuccess = checkComplete;
      } else if (op.type === 'delete' && op.kind && op.id) {
        const namespace = op.namespace || store.namespace;
        const request = objectStore.delete([namespace, op.kind, op.id]);
        request.onerror = () => {
          hasError = true;
          reject(request.error);
        };
        request.onsuccess = checkComplete;
      }
    }

    if (operations.length === 0) {
      resolve();
    }
  });
}

/**
 * Count records matching criteria.
 */
export async function countRecords(
  store: OpenStoreResult,
  options: { kind?: string; subjectId?: string } = {}
): Promise<number> {
  const { kind, subjectId } = options;

  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readonly');
    const objectStore = tx.objectStore('records');

    let index: IDBIndex;
    let range: IDBKeyRange | undefined;

    if (kind && subjectId) {
      index = objectStore.index('byNamespaceKindSubject');
      range = IDBKeyRange.bound(
        [store.namespace, kind, subjectId, ''],
        [store.namespace, kind, subjectId, '\uffff']
      );
    } else if (kind) {
      index = objectStore.index('byNamespaceKind');
      range = IDBKeyRange.bound(
        [store.namespace, kind, ''],
        [store.namespace, kind, '\uffff']
      );
    } else if (subjectId) {
      index = objectStore.index('byNamespaceSubject');
      range = IDBKeyRange.bound(
        [store.namespace, subjectId, ''],
        [store.namespace, subjectId, '\uffff']
      );
    } else {
      index = objectStore.index('byNamespaceUpdatedAt');
      range = IDBKeyRange.bound(
        [store.namespace, ''],
        [store.namespace, '\uffff']
      );
    }

    const request = index.count(range);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all records in a namespace (use with caution).
 */
export async function clearNamespace(store: OpenStoreResult): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readwrite');
    const objectStore = tx.objectStore('records');
    const index = objectStore.index('byNamespaceUpdatedAt');
    const range = IDBKeyRange.bound(
      [store.namespace, ''],
      [store.namespace, '\uffff']
    );
    const request = index.openCursor(range);

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}