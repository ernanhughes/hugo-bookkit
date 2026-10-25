/**
 * Bookkit Local Data Platform ΓÇö Record Operations
 *
 * Provides CRUD and query operations on the generic record store.
 * All write operations resolve only after the IndexedDB transaction commits.
 */

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowISO() {
  return new Date().toISOString();
}

function awaitTransaction(request) {
  return new Promise((resolve, reject) => {
    const transaction = request.transaction;
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
  });
}

export async function openStore(config) {
  const { openDatabase } = await import('./database.js');
  const dbName = config.databaseName || 'bookkit-local-v1';
  const version = config.version || 1;

  const { db } = await openDatabase({ name: dbName, version });

  return {
    db,
    namespace: config.namespace,
    close: () => db.close()
  };
}

export function createRecord(namespace, kind, subjectId, payload, options = {}) {
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

export async function getRecord(store, kind, id) {
  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readonly');
    const objectStore = tx.objectStore('records');
    const request = objectStore.get([store.namespace, kind, id]);

    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? result : null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function putRecord(store, record) {
  const namespace = store.namespace;
  const now = nowISO();

  const existing = await getRecord(store, record.kind, record.id);

  const toStore = {
    ...record,
    namespace,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    revision: (existing?.revision || 0) + 1
  };

  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readwrite');
    const objectStore = tx.objectStore('records');
    const request = objectStore.put(toStore);

    request.onsuccess = () => {
      tx.oncomplete = () => {
        window.dispatchEvent(new CustomEvent('bookkit:local:record-committed', {
          detail: { namespace, kind: record.kind, id: record.id, subjectId: record.subjectId }
        }));
        resolve(toStore);
      };
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteRecord(store, kind, id) {
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

export async function listRecords(store, options = {}) {
  const { kind, subjectId, since, limit = 10000, offset = 0, order = 'desc' } = options;

  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readonly');
    const objectStore = tx.objectStore('records');

    let index;
    let range;

    if (kind && subjectId) {
      index = objectStore.index('byNamespaceKindSubject');
      range = IDBKeyRange.only([store.namespace, kind, subjectId]);
    } else if (kind) {
      index = objectStore.index('byNamespaceKind');
      range = IDBKeyRange.only([store.namespace, kind]);
    } else if (subjectId) {
      index = objectStore.index('byNamespaceSubject');
      range = IDBKeyRange.only([store.namespace, subjectId]);
    } else {
      index = objectStore.index('byNamespaceUpdatedAt');
      range = IDBKeyRange.bound(
        [store.namespace, ''],
        [store.namespace, '\uffff']
      );
    }

    const direction = order === 'asc' ? 'next' : 'prev';
    const request = index.openCursor(range, direction);

    const results = [];
    let skipped = 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const record = cursor.value;

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
        }
        if (results.length >= limit) {
          resolve(results);
        } else {
          cursor.continue();
        }
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function batchRecords(store, operations) {
  if (operations.length === 0) return;

  for (const op of operations) {
    if (!(op.type === 'put' && op.record) &&
        !(op.type === 'delete' && op.kind && op.id)) {
      throw new TypeError('Invalid batch operation');
    }
  }

  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readwrite');
    const objectStore = tx.objectStore('records');
    let failure;

    tx.oncomplete = () => {
      for (const op of operations) {
        const namespace = op.namespace || store.namespace;
        const isPut = op.type === 'put';
        const detail = isPut
          ? { namespace, kind: op.record.kind, id: op.record.id, subjectId: op.record.subjectId }
          : { namespace, kind: op.kind, id: op.id };
        window.dispatchEvent(new CustomEvent(isPut
          ? 'bookkit:local:record-committed'
          : 'bookkit:local:record-deleted', { detail }));
      }
      resolve();
    };
    tx.onerror = () => reject(failure || tx.error);
    tx.onabort = () => reject(failure || tx.error || new Error('Transaction aborted'));

    const abort = (error) => {
      failure = error;
      tx.abort();
    };

    // Queue each operation from the previous request's success handler so the
    // transaction stays active and repeated writes see earlier batch changes.
    const enqueue = (index) => {
      if (index === operations.length) return;
      const op = operations[index];
      const namespace = op.namespace || store.namespace;
      try {
        if (op.type === 'delete') {
          const request = objectStore.delete([namespace, op.kind, op.id]);
          request.onsuccess = () => enqueue(index + 1);
        } else {
          const request = objectStore.get([namespace, op.record.kind, op.record.id]);
          request.onsuccess = () => {
            try {
              const existing = request.result;
              const now = nowISO();
              const write = objectStore.put({
                ...op.record,
                namespace,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
                revision: (existing?.revision || 0) + 1
              });
              write.onsuccess = () => enqueue(index + 1);
            } catch (error) {
              abort(error);
            }
          };
        }
      } catch (error) {
        abort(error);
      }
    };
    enqueue(0);
  });
}

export async function countRecords(store, options = {}) {
  const { kind, subjectId } = options;

  return new Promise((resolve, reject) => {
    const tx = store.db.transaction('records', 'readonly');
    const objectStore = tx.objectStore('records');

    let index;
    let range;

    if (kind && subjectId) {
      index = objectStore.index('byNamespaceKindSubject');
      range = IDBKeyRange.only([store.namespace, kind, subjectId]);
    } else if (kind) {
      index = objectStore.index('byNamespaceKind');
      range = IDBKeyRange.only([store.namespace, kind]);
    } else if (subjectId) {
      index = objectStore.index('byNamespaceSubject');
      range = IDBKeyRange.only([store.namespace, subjectId]);
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

export async function clearNamespace(store) {
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
