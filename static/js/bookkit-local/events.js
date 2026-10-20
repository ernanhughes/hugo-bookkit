/**
 * Bookkit Local Data Platform — Events
 *
 * Lightweight event system for storage notifications.
 * Events contain only metadata (IDs, namespace), never full record payloads.
 */

export type LocalEventType =
  | 'bookkit:local:ready'
  | 'bookkit:local:record-committed'
  | 'bookkit:local:record-deleted'
  | 'bookkit:local:storage-error'
  | 'bookkit:local:version-blocked'
  | 'bookkit:local:version-change';

export interface LocalEventMap {
  'bookkit:local:ready': { namespace: string; databaseName: string };
  'bookkit:local:record-committed': { namespace: string; kind: string; id: string; subjectId: string };
  'bookkit:local:record-deleted': { namespace: string; kind: string; id: string; subjectId?: string };
  'bookkit:local:storage-error': { namespace: string; error: string; operation: string };
  'bookkit:local:version-blocked': { databaseName: string; oldVersion: number; newVersion: number };
  'bookkit:local:version-change': { databaseName: string };
}

/**
 * Typed event listener.
 */
export type LocalEventListener<K extends LocalEventType> = (event: CustomEvent<LocalEventMap[K]>) => void;

/**
 * Subscribe to a local data event.
 * Returns an unsubscribe function.
 */
export function on<K extends LocalEventType>(
  type: K,
  listener: LocalEventListener<K>
): () => void {
  const handler = (event: Event) => listener(event as CustomEvent<LocalEventMap[K]>);
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}

/**
 * Subscribe once to a local data event.
 */
export function once<K extends LocalEventType>(
  type: K,
  listener: LocalEventListener<K>
): () => void {
  const handler = (event: Event) => {
    listener(event as CustomEvent<LocalEventMap[K]>);
    window.removeEventListener(type, handler);
  };
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}

/**
 * Emit a local data event (internal use).
 */
export function emit<K extends LocalEventType>(
  type: K,
  detail: LocalEventMap[K]
): boolean {
  const event = new CustomEvent(type, { detail });
  return window.dispatchEvent(event);
}

/**
 * Wait for the database to be ready for a namespace.
 * Resolves when 'bookkit:local:ready' fires for the namespace.
 */
export function waitForReady(namespace: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${namespace} database ready`));
    }, timeoutMs);

    const unsubscribe = on('bookkit:local:ready', (event) => {
      if (event.detail.namespace === namespace) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

/**
 * Listen for storage errors in a namespace.
 */
export function onStorageError(
  namespace: string,
  listener: (error: string, operation: string) => void
): () => void {
  return on('bookkit:local:storage-error', (event) => {
    if (event.detail.namespace === namespace) {
      listener(event.detail.error, event.detail.operation);
    }
  });
}

/**
 * Listen for version blocked (upgrade blocked by another tab).
 */
export function onVersionBlocked(
  listener: (oldVersion: number, newVersion: number) => void
): () => void {
  return on('bookkit:local:version-blocked', (event) => {
    listener(event.detail.oldVersion, event.detail.newVersion);
  });
}

/**
 * Listen for version change (another tab upgraded the database).
 */
export function onVersionChange(
  listener: (databaseName: string) => void
): () => void {
  return on('bookkit:local:version-change', (event) => {
    listener(event.detail.databaseName);
  });
}

/**
 * Debug: log all local events to console.
 */
export function enableDebugLogging(): () => void {
  const types: LocalEventType[] = [
    'bookkit:local:ready',
    'bookkit:local:record-committed',
    'bookkit:local:record-deleted',
    'bookkit:local:storage-error',
    'bookkit:local:version-blocked',
    'bookkit:local:version-change'
  ];

  const unsubscribers = types.map(type =>
    on(type, (event) => {
      console.log(`[bookkit-local] ${type}`, event.detail);
    })
  );

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}