/**
 * Bookkit Local Data Platform — Public API
 *
 * Main entry point for consumers. Provides a simple, documented async interface.
 */
import type { RecordEnvelope, Provenance, ListOptions, BatchOperation } from './records.js';
import type { ExportFormat, ImportOptions, ImportResult } from './portability.js';
import type { DatabaseError, StorageUnavailableError, QuotaExceededError, UpgradeBlockedError } from './database.js';

// Re-export types
export type {
  RecordEnvelope,
  Provenance,
  ListOptions,
  BatchOperation,
  ExportFormat,
  ImportOptions,
  ImportResult,
  DatabaseError,
  StorageUnavailableError,
  QuotaExceededError,
  UpgradeBlockedError
};

// Re-export errors
export { DatabaseError, StorageUnavailableError, QuotaExceededError, UpgradeBlockedError } from './database.js';

interface OpenOptions {
  namespace: string;
  databaseName?: string;
  version?: number;
}

interface StoreInstance {
  namespace: string;
  databaseName: string;
  version: number;

  // CRUD
  get<T = unknown>(kind: string, id: string): Promise<RecordEnvelope<T> | null>;
  put<T>(record: Omit<RecordEnvelope<T>, 'createdAt' | 'updatedAt' | 'revision'>): Promise<RecordEnvelope<T>>;
  delete(kind: string, id: string): Promise<void>;

  // Query
  list<T = unknown>(options?: ListOptions): Promise<RecordEnvelope<T>[]>;

  // Batch
  batch(operations: BatchOperation[]): Promise<void>;

  // Count
  count(options?: { kind?: string; subjectId?: string }): Promise<number>;

  // Portability
  export(options?: { kinds?: string[]; subjectIds?: string[] }): Promise<ExportFormat>;
  exportAndDownload(options?: { kinds?: string[]; subjectIds?: string[]; filename?: string }): Promise<void>;
  import(data: unknown, options?: ImportOptions): Promise<ImportResult>;
  importFromFile(file: File, options?: ImportOptions): Promise<ImportResult>;
  exportToMarkdown(subjectId: string): Promise<string>;
  exportMarkdownAndDownload(subjectId: string, filename?: string): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
}

interface BookkitLocalAPI {
  open(options: OpenOptions): Promise<StoreInstance>;
  checkAvailability(): Promise<{ available: boolean; reason?: string; estimate?: StorageEstimate }>;
  requestPersistence(): Promise<boolean>;
  isPersisted(): Promise<boolean>;
  deleteDatabase(name?: string): Promise<void>;
  getStorageEstimate(): Promise<StorageEstimate | null>;
}

// Internal store holder
let currentStore: StoreInstance | null = null;

/**
 * Create a store instance with bound methods.
 */
async function createStoreInstance(options: OpenOptions): Promise<StoreInstance> {
  const { openDatabase } = await import('./database.js');
  const { openStore } = await import('./records.js');
  const { exportRecords, exportAndDownload, importRecords, importFromFile, exportToMarkdown, exportMarkdownAndDownload } = await import('./portability.js');
  const { getRecord, putRecord, deleteRecord, listRecords, batchRecords, countRecords } = await import('./records.js');

  const dbName = options.databaseName || 'bookkit-local-v1';
  const version = options.version || 1;

  const { db } = await openDatabase({ name: dbName, version });
  const store = await openStore({ ...options, databaseName: dbName, version });

  // Dispatch ready event
  const { emit } = await import('./events.js');
  emit('bookkit:local:ready', { namespace: options.namespace, databaseName: dbName });

  const instance: StoreInstance = {
    namespace: options.namespace,
    databaseName: dbName,
    version,

    async get<T>(kind: string, id: string) {
      return getRecord(store, kind, id) as Promise<RecordEnvelope<T> | null>;
    },

    async put<T>(record: Omit<RecordEnvelope<T>, 'createdAt' | 'updatedAt' | 'revision'>) {
      return putRecord(store, record) as Promise<RecordEnvelope<T>>;
    },

    async delete(kind: string, id: string) {
      return deleteRecord(store, kind, id);
    },

    async list<T>(options?: ListOptions) {
      return listRecords(store, options) as Promise<RecordEnvelope<T>[]>;
    },

    async batch(operations: BatchOperation[]) {
      return batchRecords(store, operations);
    },

    async count(options?: { kind?: string; subjectId?: string }) {
      return countRecords(store, options);
    },

    async export(options?: { kinds?: string[]; subjectIds?: string[] }) {
      return exportRecords(store, options);
    },

    async exportAndDownload(options?: { kinds?: string[]; subjectIds?: string[]; filename?: string }) {
      return exportAndDownload(store, options);
    },

    async import(data: unknown, options?: ImportOptions) {
      return importRecords(store, data, options);
    },

    async importFromFile(file: File, options?: ImportOptions) {
      return importFromFile(store, file, options);
    },

    async exportToMarkdown(subjectId: string) {
      return exportToMarkdown(store, subjectId);
    },

    async exportMarkdownAndDownload(subjectId: string, filename?: string) {
      return exportMarkdownAndDownload(store, subjectId, filename);
    },

    async close() {
      store.db.close();
      currentStore = null;
    }
  };

  return instance;
}

/**
 * Main BookkitLocal API object.
 */
const BookkitLocal: BookkitLocalAPI = {
  /**
   * Open a namespaced data store.
   * Initializes IndexedDB, runs migrations, and returns a store instance.
   */
  async open(options: OpenOptions): Promise<StoreInstance> {
    if (currentStore && currentStore.namespace === options.namespace) {
      return currentStore;
    }

    const instance = await createStoreInstance(options);
    currentStore = instance;
    return instance;
  },

  /**
   * Check if IndexedDB is available and functional.
   */
  async checkAvailability() {
    const { checkAvailability } = await import('./database.js');
    return checkAvailability();
  },

  /**
   * Request persistent storage (requires user gesture in some browsers).
   */
  async requestPersistence() {
    const { requestPersistence } = await import('./database.js');
    return requestPersistence();
  },

  /**
   * Check if storage is currently persisted.
   */
  async isPersisted() {
    const { isPersisted } = await import('./database.js');
    return isPersisted();
  },

  /**
   * Delete the database entirely. Use with caution.
   */
  async deleteDatabase(name?: string) {
    const { deleteDatabase } = await import('./database.js');
    return deleteDatabase(name);
  },

  /**
   * Get storage usage estimate.
   */
  async getStorageEstimate() {
    const { getStorageEstimate } = await import('./database.js');
    return getStorageEstimate();
  }
};

// Export as default for ES module consumers
export default BookkitLocal;

// Also export as named export for compatibility
export { BookkitLocal };

// Global registration for non-module scripts (optional)
// Only register if not using modules
if (typeof window !== 'undefined' && !window.BookkitLocal) {
  window.BookkitLocal = BookkitLocal;
}