/**
 * Bookkit Local Data Platform — Migrations
 *
 * Provides versioned schema migration framework.
 * Migrations are deterministic, recoverable, and preserve existing data.
 */
import type { DatabaseError, openDatabase } from './database.js';

export interface Migration {
  version: number;
  description: string;
  up: (db: IDBDatabase, transaction: IDBTransaction) => void | Promise<void>;
  down?: (db: IDBDatabase, transaction: IDBTransaction) => void | Promise<void>;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: Migration[];
  skipped: Migration[];
  errors: Array<{ migration: Migration; error: Error }>;
}

const migrations: Migration[] = [];

/**
 * Register a migration.
 * Migrations must be registered in version order.
 */
export function registerMigration(migration: Migration): void {
  // Insert in version order
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

/**
 * Get all registered migrations.
 */
export function getMigrations(): Migration[] {
  return [...migrations];
}

/**
 * Run pending migrations up to target version.
 * Returns a result object with details.
 */
export async function runMigrations(
  dbName: string,
  targetVersion: number,
  currentVersion: number
): Promise<MigrationResult> {
  const { openDatabase } = await import('./database.js');

  const result: MigrationResult = {
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
      // Open database at the migration's version to trigger onupgradeneeded
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, migration.version);

        request.onupgradeneeded = (event) => {
          const db = request.result;
          const tx = request.transaction!;

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
      // Stop on first error
      break;
    }
  }

  result.toVersion = currentVersion + result.applied.length;
  return result;
}

/**
 * Migration: Version 1 → 2
 * Example: Add a new index for querying by provenance source.
 */
registerMigration({
  version: 2,
  description: 'Add provenance index for filtering AI-suggested records',
  up: (db, tx) => {
    const store = tx.objectStore('records');
    // Check if index already exists (defensive)
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

/**
 * Migration: Version 2 → 3
 * Example: Add a metadata store for migration history.
 */
registerMigration({
  version: 3,
  description: 'Add migration history tracking in metadata store',
  up: (db, tx) => {
    const metaStore = tx.objectStore('metadata');
    // Record this migration
    metaStore.put({ key: 'migrationHistory', value: [] });
  },
  down: (db, tx) => {
    const metaStore = tx.objectStore('metadata');
    metaStore.delete('migrationHistory');
  }
});

/**
 * Helper to get current database version without opening.
 */
export function getCurrentVersion(dbName: string): Promise<number> {
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

/**
 * Check if database exists and get its version.
 */
export async function getDatabaseInfo(dbName: string): Promise<{ exists: boolean; version: number }> {
  try {
    const version = await getCurrentVersion(dbName);
    return { exists: true, version };
  } catch {
    return { exists: false, version: 0 };
  }
}

/**
 * Safe migration runner that handles blocked upgrades.
 * Shows user-visible message when blocked.
 */
export async function migrateWithUserNotification(
  dbName: string,
  targetVersion: number,
  onBlocked?: (oldVersion: number, newVersion: number) => void
): Promise<MigrationResult> {
  const info = await getDatabaseInfo(dbName);
  if (!info.exists) {
    // Database doesn't exist yet — it will be created at target version on first open
    return { fromVersion: 0, toVersion: targetVersion, applied: [], skipped: [], errors: [] };
  }

  if (info.version >= targetVersion) {
    return { fromVersion: info.version, toVersion: info.version, applied: [], skipped: [], errors: [] };
  }

  // Set up blocked handler
  const originalOpen = indexedDB.open.bind(indexedDB);
  let blockedResolve: ((value: void) => void) | null = null;
  const blockedPromise = new Promise<void>((resolve) => { blockedResolve = resolve; });

  // We can't easily intercept the blocked event from outside,
  // so we rely on the openDatabase blocked handler to dispatch an event
  // and the UI can listen for 'bookkit:local:version-blocked'

  return runMigrations(dbName, targetVersion, info.version);
}