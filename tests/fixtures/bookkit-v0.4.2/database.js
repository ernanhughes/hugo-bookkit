/**
 * Bookkit Local Data Platform ΓÇö Database Lifecycle
 *
 * Manages IndexedDB connection, versioned schema, upgrades, and connection lifecycle.
 * All operations are async and return promises that resolve only after transactions commit.
 */
export class DatabaseError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.cause = cause;
  }
}

export class UpgradeBlockedError extends DatabaseError {
  constructor(oldVersion, newVersion) {
    super(
      `Database upgrade from v${oldVersion} to v${newVersion} blocked by open connection in another tab`,
      'UPGRADE_BLOCKED'
    );
    this.name = 'UpgradeBlockedError';
    this.oldVersion = oldVersion;
    this.newVersion = newVersion;
  }
}

export class StorageUnavailableError extends DatabaseError {
  constructor(reason) {
    super(`Browser storage unavailable: ${reason}`, 'STORAGE_UNAVAILABLE');
    this.name = 'StorageUnavailableError';
  }
}

export class QuotaExceededError extends DatabaseError {
  constructor() {
    super('Storage quota exceeded', 'QUOTA_EXCEEDED');
    this.name = 'QuotaExceededError';
  }
}

const DEFAULT_DB_NAME = 'bookkit-local-v1';
const DEFAULT_VERSION = 1;

/**
 * Check if IndexedDB is available and functional.
 */
export async function checkAvailability() {
  if (typeof indexedDB === 'undefined') {
    return { available: false, reason: 'IndexedDB not supported' };
  }

  // Probe with a temporary database
  try {
    const probeName = '__bookkit_probe__';
    await new Promise((resolve, reject) => {
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
  let estimate;
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
export async function openDatabase(config = {}) {
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
            console.warn('[bookkit-local] onUpgrade returned a promise; it may not be awaited by IndexedDB');
          }
        } catch (error) {
          console.error('[bookkit-local] Upgrade failed:', error);
          request.transaction?.abort();
          throw error;
        }
      }
    };

    request.onblocked = () => {
      if (config.onBlocked) {
        config.onBlocked(event.oldVersion, event.newVersion);
      } else {
        const blockedEvent = new CustomEvent('bookkit:local:version-blocked', {
          detail: { databaseName: name, oldVersion: event.oldVersion, newVersion: event.newVersion }
        });
        window.dispatchEvent(blockedEvent);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      const upgraded = db.version > (event.oldVersion || 0);

      db.onversionchange = () => {
        if (config.onVersionChange) {
          config.onVersionChange();
        } else {
          const vcEvent = new CustomEvent('bookkit:local:version-change', {
            detail: { databaseName: name }
          });
          window.dispatchEvent(vcEvent);
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
          error
        ));
      }
    };
  });
}

/**
 * Create the version 1 schema.
 */
function createSchemaV1(db) {
  const recordsStore = db.createObjectStore('records', { keyPath: ['namespace', 'kind', 'id'] });

  recordsStore.createIndex('byNamespaceSubject', ['namespace', 'subjectId'], { unique: false });
  recordsStore.createIndex('byNamespaceKind', ['namespace', 'kind'], { unique: false });
  recordsStore.createIndex('byNamespaceKindSubject', ['namespace', 'kind', 'subjectId'], { unique: false });
  recordsStore.createIndex('byNamespaceUpdatedAt', ['namespace', 'updatedAt'], { unique: false });

  db.createObjectStore('metadata', { keyPath: 'key' });
}

/**
 * Close a database connection cleanly.
 */
export function closeDatabase(db) {
  if (db && db.objectStoreNames.length > 0) {
    db.close();
  }
}

/**
 * Delete the database entirely.
 */
export function deleteDatabase(name = DEFAULT_DB_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new DatabaseError(
      request.error?.message || 'Failed to delete database',
      'DELETE_FAILED',
      request.error
    ));
    request.onblocked = () => {
      reject(new UpgradeBlockedError(0, 0));
    };
  });
}

/**
 * Get storage usage estimate.
 */
export async function getStorageEstimate() {
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
 * Request persistent storage.
 */
export async function requestPersistence() {
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
export async function isPersisted() {
  if (navigator.storage?.persisted) {
    try {
      return await navigator.storage.persisted();
    } catch {
      return false;
    }
  }
  return false;
}
