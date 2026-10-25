/**
 * Bookkit Local Data Platform ΓÇö Events
 *
 * Lightweight event system for storage notifications.
 * Events contain only metadata (IDs, namespace), never full record payloads.
 */

export const EventTypes = {
  READY: 'bookkit:local:ready',
  RECORD_COMMITTED: 'bookkit:local:record-committed',
  RECORD_DELETED: 'bookkit:local:record-deleted',
  STORAGE_ERROR: 'bookkit:local:storage-error',
  VERSION_BLOCKED: 'bookkit:local:version-blocked',
  VERSION_CHANGE: 'bookkit:local:version-change'
};

export function on(type, listener) {
  const handler = (event) => listener(event);
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}

export function once(type, listener) {
  const handler = (event) => {
    listener(event);
    window.removeEventListener(type, handler);
  };
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}

export function emit(type, detail) {
  const event = new CustomEvent(type, { detail });
  return window.dispatchEvent(event);
}

export function waitForReady(namespace, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${namespace} database ready`));
    }, timeoutMs);

    const unsubscribe = on(EventTypes.READY, (event) => {
      if (event.detail.namespace === namespace) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

export function onStorageError(namespace, listener) {
  return on(EventTypes.STORAGE_ERROR, (event) => {
    if (event.detail.namespace === namespace) {
      listener(event.detail.error, event.detail.operation);
    }
  });
}

export function onVersionBlocked(listener) {
  return on(EventTypes.VERSION_BLOCKED, (event) => {
    listener(event.detail.oldVersion, event.detail.newVersion);
  });
}

export function onVersionChange(listener) {
  return on(EventTypes.VERSION_CHANGE, (event) => {
    listener(event.detail.databaseName);
  });
}

export function enableDebugLogging() {
  const types = Object.values(EventTypes);

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
