/**
 * Bookkit Local Data Platform — Database Lifecycle
 *
 * Manages IndexedDB connection, versioned schema, upgrades, and connection lifecycle.
 * All operations are async and return promises that resolve only after transactions commit.
 */
export const DatabaseError = class DatabaseError extends Error {
  constructor(message, public readonly code: string, public readonly cause?: Error) {
    super(message);
    this.name = 'DatabaseError';
  }
};

export const UpgradeBlockedError = class UpgradeBlockedError extends DatabaseError {
  constructor(public readonly oldVersion: number, public readonly newVersion: number) {
    super(
      `Database upgrade from v${oldVersion} to v${newVersion} blocked by open connection in another tab`,
      'UPGRADE_BLOCKED'
    );
    this.name = 'UpgradeBlockedError';
  }
};

export const StorageUnavailableError = class StorageUnavailableError extends DatabaseError {
  constructor(reason: string) {
    super(`Browser storage unavailable: ${reason}`, 'STORAGE_UNAVAILABLE');
    this.name = 'StorageUnavailableError';
  }
};

export const QuotaExceededError = class QuotaExceededError extends DatabaseError {
  constructor() {
    super('Storage quota exceeded', 'QUOTA_EXCEEDED');
    this.name = 'QuotaExceededError';
  }
};

interface DatabaseConfig {
  name: string;
  version: number;
  onUpgrade?: (db: IDBDatabase, oldVersion: number, newVersion: number) => void | Promise<void>;
  onBlocked?: (oldVersion: number, newVersion: number) => void;
  onVersionChange?: () => void;
}

interface OpenResult {
  db: IDBDatabase;
  upgraded: boolean;
  previousVersion: number;
}

const DEFAULT_DB_NAME = 'bookkit-local-v1';
const DEFAULT_VERSION = 1;

/**
 * Check if IndexedDB is available and functional.
 */
export async function checkAvailability(): Promise<{
  available: boolean;
  reason?: string;
  estimate?: StorageEstimate;
}> {
  if (typeof indexedDB === 'undefined') {
    return { available: false, reason: 'IndexedDB not supported' };
  }

  // Probe with a temporary database
  try {
    const probeName = '__bookkit_probe__';
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(probeName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('probe');
      };
      req.onsuccess = () => {
        req.result.close();
        indexedDB.deleteDatabase(probeName);
        resolve();
      };
      req.onerror = () => reject(new Error('Probe failed'));
      req.onblocked = () => reject(new Error('Probe blocked'));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('private') || message.includes('Private')) {
      return { available: false, reason: 'Private browsing mode restricts IndexedDB' };
    }
    return { available: false, reason: message };
  }

  // Get storage estimate if available
  let estimate: StorageEstimate | undefined;
  if (navigator.storage?.estimate) {
    try {
      estimate = await navigator.storage.estimate();
    } catch {
      // Ignore estimate errors
    }
  }

  return { available: true, estimate };
}

/**
 * Open or create the database with versioned schema.
 * Returns the database connection and upgrade status.
 */
export async function openDatabase(config: DatabaseConfig = {}): Promise<OpenResult> {
  const name = config.name || DEFAULT_DB_NAME;
  const version = config.version || DEFAULT_VERSION;

  const availability = await checkAvailability();
  if (!availability.available) {
    throw new StorageUnavailableError(availability.reason || 'Unknown reason');
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      const newVersion = event.newVersion;

      // Create object stores for version 1
      if (oldVersion < 1) {
        createSchemaV1(db);
      }

      // Run custom upgrade logic if provided
      if (config.onUpgrade) {
        try {
          const result = config.onUpgrade(db, oldVersion, newVersion);
          if (result instanceof Promise) {
            // Note: IDB upgrade transactions don't await promises.
            // Custom upgrades must be synchronous or use the transaction directly.
            console.warn('[bookkit-local] onUpgrade returned a promise; it may not be awaited by IndexedDB');
          }
        } catch (error) {
          console.error('[bookkit-local] Upgrade failed:', error);
          // Abort the upgrade by throwing
          request.transaction?.abort();
          throw error;
        }
      }
    };

    request.onblocked = () => {
      if (config.onBlocked) {
        config.onBlocked(event.oldVersion, event.newVersion);
      } else {
        // Default: notify via event for UI to handle
        const blockedEvent = new CustomEvent('bookkit:local:version-blocked', {
          detail: { databaseName: name, oldVersion: event.oldVersion, newVersion: event.newVersion }
        });
        window.dispatchEvent(blockedEvent);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      const upgraded = db.version > (event.oldVersion || 0);

      // Handle versionchange from other tabs
      db.onversionchange = () => {
        if (config.onVersionChange) {
          config.onVersionChange();
        } else {
          const vcEvent = new CustomEvent('bookkit:local:version-change', {
            detail: { databaseName: name }
          });
          window.dispatchEvent(vcEvent);
          // Close to allow the upgrade to proceed
          db.close();
        }
      };

      resolve({ db, upgraded, previousVersion: event.oldVersion || 0 });
    };

    request.onerror = () => {
      const error = request.error;
      if (error?.name === 'QuotaExceededError' || error?.name === 'ConstraintError') {
        reject(new QuotaExceededError());
      } else if (error?.name === 'SecurityError') {
        reject(new StorageUnavailableError('Security error (possibly private browsing)'));
      } else if (error?.name === 'UnknownError') {
        reject(new StorageUnavailableError('Unknown IndexedDB error'));
      } else {
        reject(new DatabaseError(
          error?.message || 'Failed to open database',
          'OPEN_FAILED',
          error ?? undefined
        ));
      }
    };
  });
}

/**
 * Create the version 1 schema.
 */
function createSchemaV1(db: IDBDatabase): void {
  // Records store: compound key [namespace, kind, id]
  const recordsStore = db.createObjectStore('records', { keyPath: ['namespace', 'kind', 'id'] });

  // Indexes for common query patterns
  recordsStore.createIndex('byNamespaceSubject', ['namespace', 'subjectId'], { unique: false });
  recordsStore.createIndex('byNamespaceKind', ['namespace', 'kind'], { unique: false });
  recordsStore.createIndex('byNamespaceKindSubject', ['namespace', 'kind', 'subjectId'], { unique: false });
  recordsStore.createIndex('byNamespaceUpdatedAt', ['namespace', 'updatedAt'], { unique: false });

  // Metadata store for platform-level data
  db.createObjectStore('metadata', { keyPath: 'key' });
}

/**
 * Close a database connection cleanly.
 */
export function closeDatabase(db: IDBDatabase): void {
  if (db && db.objectStoreNames.length > 0) {
    db.close();
  }
}

/**
 * Delete the database entirely.
 * Use with caution — this destroys all data.
 */
export function deleteDatabase(name: string = DEFAULT_DB_NAME): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new DatabaseError(
      request.error?.message || 'Failed to delete database',
      'DELETE_FAILED',
      request.error ?? undefined
    ));
    request.onblocked = () => {
      reject(new UpgradeBlockedError(0, 0)); // Version unknown on delete
    };
  });
}

/**
 * Get storage usage estimate.
 */
export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (navigator.storage?.estimate) {
    try {
      return await navigator.storage.estimate();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Request persistent storage (user gesture required in some browsers).
 * Returns true if granted, false if denied or unavailable.
 */
export async function requestPersistence(): Promise<boolean> {
  if (navigator.storage?.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Check if storage is persisted.
 */
export async function isPersisted(): Promise<boolean> {
  if (navigator.storage?.persisted) {
    try {
      return await navigator.storage.persisted();
    } catch {
      return false;
    }
  }
  return false;
}