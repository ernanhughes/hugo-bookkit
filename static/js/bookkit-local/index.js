/**
 * Bookkit Local Data Platform - public API.
 *
 * const store = await BookkitLocal.open({ namespace: 'research' });
 * await store.put({ kind: 'note', id: '...', subjectId: '...', payload: {...} });
 * const notes = await store.list({ kind: 'note', subjectId: '...' });
 *
 * Write promises resolve after IndexedDB commits, not merely after a request
 * succeeds. Callers should pass { expectedRevision } when editing an existing
 * record to avoid overwriting a newer edit from another tab.
 */

import {
  openDatabase,
  checkAvailability,
  getStorageEstimate,
  requestPersistence,
  isPersisted,
  getStorageDiagnostics,
  deleteDatabase,
  isConnectionClosed
} from './database.js';
import {
  openStore,
  closeStore,
  createRecord,
  getRecord,
  putRecord,
  deleteRecord,
  listRecords,
  countRecords,
  batchRecords,
  putMany,
  deleteMany,
  clearNamespace,
  deleteSubject
} from './records.js';
import {
  exportRecords,
  downloadExport,
  exportAndDownload,
  importRecords,
  importFromFile,
  validateExportData
} from './portability.js';
import { emit, EventTypes } from './events.js';
import {
  DatabaseError,
  StorageUnavailableError,
  QuotaExceededError,
  UpgradeBlockedError,
  VersionMismatchError,
  ConnectionClosedError,
  ValidationError,
  ConflictError,
  ImportError,
  BookkitLocalError
} from './errors.js';
import { DATABASE_VERSION, PLATFORM_VERSION } from './migrations.js';

export { PLATFORM_VERSION };
export const DEFAULT_DATABASE_NAME = 'bookkit-local-v1';

const stores = new Map();

function cacheKey(databaseName, namespace) {
  return `${databaseName}\u0000${namespace}`;
}

async function createStoreInstance(options) {
  const databaseName = options.databaseName || DEFAULT_DATABASE_NAME;
  const store = await openStore({
    ...options,
    databaseName
  });
  const key = cacheKey(store.databaseName, store.namespace);

  const instance = {
    namespace: store.namespace,
    databaseName: store.databaseName,
    version: store.schemaVersion,
    schemaVersion: store.schemaVersion,
    upgraded: store.upgraded,
    previousVersion: store.previousVersion,

    put(record, putOptions) {
      return putRecord(store, record, putOptions);
    },

    putMany(records, putOptions) {
      return putMany(store, records, putOptions);
    },

    get(kind, id) {
      return getRecord(store, kind, id);
    },

    list(query) {
      return listRecords(store, query);
    },

    count(query) {
      return countRecords(store, query);
    },

    delete(kind, id, deleteOptions) {
      return deleteRecord(store, kind, id, deleteOptions);
    },

    deleteMany(items, deleteOptions) {
      return deleteMany(store, items, deleteOptions);
    },

    batch(operations) {
      return batchRecords(store, operations);
    },

    deleteSubject(subjectId) {
      return deleteSubject(store, subjectId);
    },

    clearNamespace() {
      return clearNamespace(store);
    },

    export(exportOptions) {
      return exportRecords(store, exportOptions);
    },

    downloadExport(exportOptions) {
      return downloadExport(store, exportOptions);
    },

    exportAndDownload(exportOptions) {
      return exportAndDownload(store, exportOptions);
    },

    import(data, importOptions) {
      return importRecords(store, data, importOptions);
    },

    importFromFile(file, importOptions) {
      return importFromFile(store, file, importOptions);
    },

    async getDiagnostics() {
      const storage = await getStorageDiagnostics();
      return {
        available: true,
        namespace: store.namespace,
        databaseName: store.databaseName,
        schemaVersion: store.schemaVersion,
        ...storage
      };
    },

    async close() {
      if (store.closed) return;
      stores.delete(key);
      closeStore(store);
    },

    get closed() {
      return store.closed || isConnectionClosed(store.entry);
    }
  };

  stores.set(key, instance);
  emit(EventTypes.READY, {
    namespace: store.namespace,
    databaseName: store.databaseName,
    schemaVersion: store.schemaVersion
  });
  return instance;
}

const BookkitLocal = {
  platformVersion: PLATFORM_VERSION,
  schemaVersion: DATABASE_VERSION,
  EventTypes,

  async open(options = {}) {
    if (!options.namespace) {
      throw new ValidationError('BookkitLocal.open requires a namespace');
    }
    const databaseName = options.databaseName || DEFAULT_DATABASE_NAME;
    const key = cacheKey(databaseName, options.namespace);
    const cached = stores.get(key);
    if (cached && !cached.closed) return cached;
    if (cached) stores.delete(key);

    return createStoreInstance({ ...options, databaseName });
  },

  checkAvailability,
  getStorageEstimate,
  requestPersistence,
  isPersisted,
  getStorageDiagnostics,
  deleteDatabase,
  createRecord,
  validateExport: validateExportData,

  errors: {
    BookkitLocalError,
    DatabaseError,
    StorageUnavailableError,
    QuotaExceededError,
    UpgradeBlockedError,
    VersionMismatchError,
    ConnectionClosedError,
    ValidationError,
    ConflictError,
    ImportError
  }
};

export default BookkitLocal;
export {
  BookkitLocal,
  openDatabase,
  checkAvailability,
  getStorageEstimate,
  requestPersistence,
  isPersisted,
  getStorageDiagnostics,
  deleteDatabase,
  createRecord,
  getRecord,
  putRecord,
  deleteRecord,
  listRecords,
  countRecords,
  batchRecords,
  clearNamespace,
  deleteSubject,
  exportRecords,
  downloadExport,
  exportAndDownload,
  importRecords,
  importFromFile,
  validateExportData,
  emit,
  EventTypes,
  DatabaseError,
  StorageUnavailableError,
  QuotaExceededError,
  UpgradeBlockedError,
  VersionMismatchError,
  ConnectionClosedError,
  ValidationError,
  ConflictError,
  ImportError,
  BookkitLocalError
};

if (typeof window !== 'undefined' && !window.BookkitLocal) {
  window.BookkitLocal = BookkitLocal;
}
