/**
 * Bookkit Local Data Platform — Public API
 *
 * Main entry point for consumers. Provides a simple, documented async interface.
 */

export { DatabaseError, StorageUnavailableError, QuotaExceededError, UpgradeBlockedError } from './database.js';
export { registerMigration, getMigrations, runMigrations, getCurrentVersion, getDatabaseInfo, migrateWithUserNotification } from './migrations.js';
export { on, once, emit, waitForReady, onStorageError, onVersionBlocked, onVersionChange, enableDebugLogging, EventTypes } from './events.js';
export { exportRecords, exportAndDownload, importRecords, importFromFile, exportToMarkdown, exportMarkdownAndDownload } from './portability.js';
export { openStore, createRecord, getRecord, putRecord, deleteRecord, listRecords, batchRecords, countRecords, clearNamespace } from './records.js';

let currentStore = null;

async function createStoreInstance(options) {
  const { openDatabase } = await import('./database.js');
  const { openStore } = await import('./records.js');
  const { exportRecords, exportAndDownload, importRecords, importFromFile, exportToMarkdown, exportMarkdownAndDownload } = await import('./portability.js');
  const { getRecord, putRecord, deleteRecord, listRecords, batchRecords, countRecords } = await import('./records.js');
  const { emit } = await import('./events.js');

  const dbName = options.databaseName || 'bookkit-local-v1';
  const version = options.version || 1;

  const { db } = await openDatabase({ name: dbName, version });
  const store = await openStore({ ...options, databaseName: dbName, version });

  emit('bookkit:local:ready', { namespace: options.namespace, databaseName: dbName });

  const instance = {
    namespace: options.namespace,
    databaseName: dbName,
    version,

    async get(kind, id) {
      return getRecord(store, kind, id);
    },

    async put(record) {
      return putRecord(store, record);
    },

    async delete(kind, id) {
      return deleteRecord(store, kind, id);
    },

    async list(options) {
      return listRecords(store, options);
    },

    async batch(operations) {
      return batchRecords(store, operations);
    },

    async count(options) {
      return countRecords(store, options);
    },

    async export(options) {
      return exportRecords(store, options);
    },

    async exportAndDownload(options) {
      return exportAndDownload(store, options);
    },

    async import(data, options) {
      return importRecords(store, data, options);
    },

    async importFromFile(file, options) {
      return importFromFile(store, file, options);
    },

    async exportToMarkdown(subjectId) {
      return exportToMarkdown(store, subjectId);
    },

    async exportMarkdownAndDownload(subjectId, filename) {
      return exportMarkdownAndDownload(store, subjectId, filename);
    },

    async close() {
      store.db.close();
      currentStore = null;
    }
  };

  return instance;
}

const BookkitLocal = {
  async open(options) {
    if (currentStore && currentStore.namespace === options.namespace) {
      return currentStore;
    }

    const instance = await createStoreInstance(options);
    currentStore = instance;
    return instance;
  },

  async checkAvailability() {
    const { checkAvailability } = await import('./database.js');
    return checkAvailability();
  },

  async requestPersistence() {
    const { requestPersistence } = await import('./database.js');
    return requestPersistence();
  },

  async isPersisted() {
    const { isPersisted } = await import('./database.js');
    return isPersisted();
  },

  async deleteDatabase(name) {
    const { deleteDatabase } = await import('./database.js');
    return deleteDatabase(name);
  },

  async getStorageEstimate() {
    const { getStorageEstimate } = await import('./database.js');
    return getStorageEstimate();
  }
};

export default BookkitLocal;
export { BookkitLocal };

if (typeof window !== 'undefined' && !window.BookkitLocal) {
  window.BookkitLocal = BookkitLocal;
}