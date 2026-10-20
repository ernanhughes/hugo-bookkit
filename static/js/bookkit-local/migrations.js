/**
 * Bookkit Local Data Platform — Migrations
 *
 * Provides versioned schema migration framework.
 * Migrations are deterministic, recoverable, and preserve existing data.
 */

const migrations = [];

export function registerMigration(migration) {
  const idx = migrations.findIndex(m => m.version >= migration.version);
  if (idx >= 0 && migrations[idx].version === migration.version) {
    throw new Error(`Migration for version ${migration.version} already registered`);
  }
  if (idx >= 0) {
    migrations.splice(idx, 0, migration);
  } else {
    migrations.push(migration);
  }
}

export function getMigrations() {
  return [...migrations];
}

export async function runMigrations(dbName, targetVersion, currentVersion) {
  const result = {
    fromVersion: currentVersion,
    toVersion: targetVersion,
    applied: [],
    skipped: [],
    errors: []
  };

  if (currentVersion >= targetVersion) {
    result.skipped = migrations.filter(m => m.version <= currentVersion && m.version <= targetVersion);
    return result;
  }

  const pending = migrations.filter(m => m.version > currentVersion && m.version <= targetVersion);

  for (const migration of pending) {
    try {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, migration.version);

        request.onupgradeneeded = (event) => {
          const db = request.result;
          const tx = request.transaction;

          try {
            migration.up(db, tx);
            result.applied.push(migration);
          } catch (error) {
            tx.abort();
            throw error;
          }
        };

        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`Migration v${migration.version} blocked`));
      });
    } catch (error) {
      result.errors.push({ migration, error: error instanceof Error ? error : new Error(String(error)) });
      break;
    }
  }

  result.toVersion = currentVersion + result.applied.length;
  return result;
}

registerMigration({
  version: 2,
  description: 'Add provenance index for filtering AI-suggested records',
  up: (db, tx) => {
    const store = tx.objectStore('records');
    if (!store.indexNames.contains('byNamespaceProvenance')) {
      store.createIndex('byNamespaceProvenance', ['namespace', 'provenance.source'], { unique: false });
    }
  },
  down: (db, tx) => {
    const store = tx.objectStore('records');
    if (store.indexNames.contains('byNamespaceProvenance')) {
      store.deleteIndex('byNamespaceProvenance');
    }
  }
});

registerMigration({
  version: 3,
  description: 'Add migration history tracking in metadata store',
  up: (db, tx) => {
    const metaStore = tx.objectStore('metadata');
    metaStore.put({ key: 'migrationHistory', value: [] });
  },
  down: (db, tx) => {
    const metaStore = tx.objectStore('metadata');
    metaStore.delete('migrationHistory');
  }
});

export function getCurrentVersion(dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = () => {
      const version = request.result.version;
      request.result.close();
      resolve(version);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getDatabaseInfo(dbName) {
  try {
    const version = await getCurrentVersion(dbName);
    return { exists: true, version };
  } catch {
    return { exists: false, version: 0 };
  }
}

export async function migrateWithUserNotification(dbName, targetVersion, onBlocked) {
  const info = await getDatabaseInfo(dbName);
  if (!info.exists) {
    return { fromVersion: 0, toVersion: targetVersion, applied: [], skipped: [], errors: [] };
  }

  if (info.version >= targetVersion) {
    return { fromVersion: info.version, toVersion: info.version, applied: [], skipped: [], errors: [] };
  }

  return runMigrations(dbName, targetVersion, info.version);
}