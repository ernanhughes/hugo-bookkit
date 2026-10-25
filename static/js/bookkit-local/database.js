/**
 * Bookkit Local Data Platform - database lifecycle.
 *
 * One connection is shared by every namespace in a page. Namespaces are rows
 * in the generic record store, not separate databases. A version-change event
 * closes the connection so a newer tab can upgrade without being blocked
 * forever; the stale page must reload.
 */

import {
  DatabaseError,
  StorageUnavailableError,
  QuotaExceededError,
  UpgradeBlockedError,
  VersionMismatchError,
  ConnectionClosedError,
  normaliseError
} from './errors.js';
import {
  DATABASE_VERSION,
  METADATA_STORE,
  RECORDS_STORE,
  runUpgrade,
  missingIndexes
} from './migrations.js';
import { emit, EventTypes } from './events.js';

export const DEFAULT_DATABASE_NAME = 'bookkit-local-v1';

const connections = new Map();
const opening = new Map();

function validateVersion(version) {
  if (!Number.isInteger(version) || version < 1) {
    throw new DatabaseError(
      `Invalid local database version: ${version}`,
      'INVALID_VERSION'
    );
  }
}

/**
 * Verify the opened database has the stores and indexes this runtime expects.
 * It never repairs or deletes an incompatible database.
 */
function assertSchema(db, databaseName) {
  if (!db.objectStoreNames.contains(RECORDS_STORE)) {
    throw new DatabaseError(
      `The "${databaseName}" database has no records store`,
      'SCHEMA_INCOMPATIBLE'
    );
  }
  if (!db.objectStoreNames.contains(METADATA_STORE)) {
    throw new DatabaseError(
      `The "${databaseName}" database has no metadata store`,
      'SCHEMA_INCOMPATIBLE'
    );
  }

  const transaction = db.transaction(RECORDS_STORE, 'readonly');
  const records = transaction.objectStore(RECORDS_STORE);
  const missing = missingIndexes(records);
  if (missing.length > 0) {
    throw new DatabaseError(
      `The "${databaseName}" database is missing required indexes: ${missing.join(', ')}`,
      'SCHEMA_INCOMPATIBLE'
    );
  }
}

function closeEntry(entry) {
  if (!entry || entry.closed) return;
  entry.closed = true;
  connections.delete(entry.name);
  try {
    entry.db.close();
  } catch {
    // The browser may already have closed it.
  }
}

function openRaw(databaseName, version, config) {
  return new Promise((resolve, reject) => {
    let request;
    let previousVersion = 0;
    let upgradeError = null;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    try {
      request = indexedDB.open(databaseName, version);
    } catch (error) {
      fail(normaliseError(error, 'opening local storage'));
      return;
    }

    request.onupgradeneeded = (event) => {
      previousVersion = event.oldVersion;
      try {
        runUpgrade(request.result, request.transaction, event.oldVersion, event.newVersion);

        if (typeof config.onUpgrade === 'function') {
          const result = config.onUpgrade(request.result, event.oldVersion, event.newVersion);
          if (result && typeof result.then === 'function') {
            console.warn('[bookkit-local] onUpgrade must be synchronous; returning a Promise is not supported');
          }
        }
      } catch (error) {
        upgradeError = normaliseError(error, 'upgrading local storage');
        try {
          request.transaction.abort();
        } catch {
          // The browser may have aborted already.
        }
      }
    };

    request.onblocked = (event) => {
      const oldVersion = event.oldVersion ?? previousVersion;
      const newVersion = event.newVersion ?? version;
      emit(EventTypes.VERSION_BLOCKED, {
        reason: 'blocked',
        databaseName,
        oldVersion,
        newVersion
      });
      if (typeof config.onBlocked === 'function') {
        config.onBlocked(oldVersion, newVersion);
      }
    };

    request.onsuccess = () => {
      if (settled) return;
      const db = request.result;

      if (upgradeError) {
        try { db.close(); } catch { /* ignore */ }
        fail(upgradeError);
        return;
      }

      try {
        assertSchema(db, databaseName);
      } catch (error) {
        try { db.close(); } catch { /* ignore */ }
        fail(error);
        return;
      }

      const entry = {
        name: databaseName,
        db,
        version: db.version,
        refs: 1,
        closed: false,
        config
      };

      db.onversionchange = (event) => {
        emit(EventTypes.VERSION_CHANGE, {
          databaseName,
          oldVersion: db.version,
          newVersion: event.newVersion
        });
        emit(EventTypes.VERSION_BLOCKED, {
          reason: 'version-change',
          databaseName,
          oldVersion: db.version,
          newVersion: event.newVersion
        });
        if (typeof config.onVersionChange === 'function') {
          try { config.onVersionChange(event.newVersion); } catch { /* consumer error */ }
        }
        closeEntry(entry);
      };

      db.onclose = () => {
        if (entry.closed) return;
        entry.closed = true;
        connections.delete(databaseName);
        emit(EventTypes.CONNECTION_CLOSED, {
          databaseName,
          code: 'CONNECTION_CLOSED'
        });
        emit(EventTypes.STORAGE_ERROR, {
          databaseName,
          namespace: null,
          operation: 'connection',
          code: 'CONNECTION_CLOSED',
          message: 'The browser closed the local database unexpectedly'
        });
      };

      connections.set(databaseName, entry);
      settled = true;
      resolve({ entry, upgraded: db.version > previousVersion, previousVersion });
    };

    request.onerror = () => {
      if (settled) return;
      const error = request.error;
      if (upgradeError) {
        fail(upgradeError);
        return;
      }
      if (error?.name === 'VersionError') {
        fail(new VersionMismatchError(databaseName, 'newer', version));
        return;
      }
      if (error?.name === 'QuotaExceededError') {
        fail(new QuotaExceededError(error));
        return;
      }
      if (error?.name === 'SecurityError') {
        fail(new StorageUnavailableError('the browser denied access to local storage'));
        return;
      }
      fail(normaliseError(error, 'opening local storage'));
    };
  });
}

/**
 * Open (or reuse) a versioned database connection.
 * Returns { entry, upgraded, previousVersion }.
 */
export async function openDatabase(config = {}) {
  const databaseName = config.name || config.databaseName || DEFAULT_DATABASE_NAME;
  const version = Number(config.version || config.schemaVersion || DATABASE_VERSION);
  validateVersion(version);

  if (typeof indexedDB === 'undefined') {
    throw new StorageUnavailableError('IndexedDB is not supported by this browser');
  }

  const existing = connections.get(databaseName);
  if (existing && !existing.closed) {
    if (existing.version !== version) {
      if (version < existing.version) {
        throw new VersionMismatchError(databaseName, existing.version, version);
      }
      throw new DatabaseError(
        `The "${databaseName}" database is already open at v${existing.version}; close it before opening v${version}`,
        'VERSION_CONFLICT'
      );
    }
    existing.refs += 1;
    return { entry: existing, upgraded: false, previousVersion: existing.version };
  }

  const pending = opening.get(databaseName);
  if (pending) {
    const result = await pending;
    if (result.entry.version !== version) {
      throw new DatabaseError(
        `The "${databaseName}" database was opened concurrently at v${result.entry.version}, not v${version}`,
        'VERSION_CONFLICT'
      );
    }
    result.entry.refs += 1;
    return { entry: result.entry, upgraded: false, previousVersion: result.previousVersion };
  }

  const promise = openRaw(databaseName, version, config);
  opening.set(databaseName, promise);
  try {
    return await promise;
  } finally {
    opening.delete(databaseName);
  }
}

/**
 * Release a connection obtained from openDatabase().
 * The underlying IndexedDB connection closes when the last user releases it.
 */
export function releaseDatabase(entry) {
  if (!entry || entry.closed) return;
  entry.refs -= 1;
  if (entry.refs <= 0) closeEntry(entry);
}

export function isConnectionClosed(entry) {
  return !entry || entry.closed;
}

/**
 * Capability check. It does not create a probe database; a real open() call
 * remains the authoritative test for private-mode and security failures.
 */
export async function checkAvailability() {
  if (typeof indexedDB === 'undefined') {
    return {
      available: false,
      reason: 'IndexedDB is not supported by this browser'
    };
  }

  let estimate = null;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      estimate = await navigator.storage.estimate();
    } catch {
      estimate = null;
    }
  }

  return { available: true, estimate };
}

export async function getStorageEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

export async function requestPersistence() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

export async function getStorageDiagnostics() {
  const estimate = await getStorageEstimate();
  const persisted = await isPersisted();
  return { estimate, persisted };
}

/**
 * Delete a database. Intended for explicit user/developer reset tooling only;
 * migrations never call it.
 */
export async function deleteDatabase(databaseName = DEFAULT_DATABASE_NAME) {
  const existing = connections.get(databaseName);
  if (existing) closeEntry(existing);

  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.deleteDatabase(databaseName);
    } catch (error) {
      reject(normaliseError(error, 'deleting local storage'));
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => reject(normaliseError(request.error, 'deleting local storage'));
    request.onblocked = () => reject(new UpgradeBlockedError(0, 0));
  });
}

export { DatabaseError, StorageUnavailableError, QuotaExceededError, UpgradeBlockedError, VersionMismatchError, ConnectionClosedError };
