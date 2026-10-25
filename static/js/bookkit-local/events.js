/**
 * Bookkit Local Data Platform - events.
 *
 * Events are advisory. The storage layer never waits for consumers and never
 * puts record payloads in event details. IndexedDB remains authoritative;
 * BroadcastChannel only nudges other tabs to re-read it.
 */

export const EventTypes = Object.freeze({
  READY: 'bookkit:local:ready',
  RECORD_COMMITTED: 'bookkit:local:record-committed',
  RECORD_DELETED: 'bookkit:local:record-deleted',
  NAMESPACE_CLEARED: 'bookkit:local:namespace-cleared',
  IMPORT_COMPLETED: 'bookkit:local:import-completed',
  STORAGE_ERROR: 'bookkit:local:storage-error',
  VERSION_BLOCKED: 'bookkit:local:version-blocked',
  VERSION_CHANGE: 'bookkit:local:version-change',
  CONNECTION_CLOSED: 'bookkit:local:connection-closed'
});

const BROADCAST_TYPES = new Set([
  EventTypes.RECORD_COMMITTED,
  EventTypes.RECORD_DELETED,
  EventTypes.NAMESPACE_CLEARED,
  EventTypes.IMPORT_COMPLETED,
  EventTypes.STORAGE_ERROR,
  EventTypes.VERSION_BLOCKED,
  EventTypes.VERSION_CHANGE,
  EventTypes.CONNECTION_CLOSED
]);

const CHANNEL_NAME = 'bookkit-local-events';
const SOURCE_ID = (() => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // Fall through to a non-cryptographic correlation id.
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
})();

let channel = null;
let channelInitialised = false;

function ensureChannel() {
  if (channelInitialised || typeof window === 'undefined') return;
  channelInitialised = true;

  if (typeof BroadcastChannel === 'undefined') return;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || typeof message !== 'object' || message.sourceId === SOURCE_ID) return;
      if (typeof message.type !== 'string') return;
      const detail = {
        ...(message.detail && typeof message.detail === 'object' ? message.detail : {}),
        remote: true,
        sourceId: message.sourceId
      };
      window.dispatchEvent(new CustomEvent(message.type, { detail }));
    });
  } catch {
    channel = null;
  }
}

/**
 * Dispatch a same-tab DOM event and, selectively, notify other tabs.
 * Only metadata belongs in `detail`; callers must never pass a payload.
 */
export function emit(type, detail = {}, options = {}) {
  if (typeof window === 'undefined') return false;
  ensureChannel();

  const eventDetail = { ...detail };
  const dispatched = window.dispatchEvent(new CustomEvent(type, { detail: eventDetail }));

  if (options.broadcast !== false && BROADCAST_TYPES.has(type) && channel) {
    try {
      channel.postMessage({ type, detail: eventDetail, sourceId: SOURCE_ID });
    } catch {
      // Notification failure must never fail the committed storage operation.
    }
  }
  return dispatched;
}

export function on(type, listener) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}

export function once(type, listener) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => {
    listener(event);
    window.removeEventListener(type, handler);
  };
  window.addEventListener(type, handler);
  return () => window.removeEventListener(type, handler);
}

export function waitForReady(namespace, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for the "${namespace}" local store`));
    }, timeoutMs);

    const unsubscribe = on(EventTypes.READY, (event) => {
      if (!namespace || event.detail.namespace === namespace) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event.detail);
      }
    });
  });
}

export function onStorageError(namespace, listener) {
  return on(EventTypes.STORAGE_ERROR, (event) => {
    if (!namespace || event.detail.namespace === namespace) {
      listener(event.detail);
    }
  });
}

export function onVersionBlocked(listener) {
  return on(EventTypes.VERSION_BLOCKED, (event) => listener(event.detail));
}

export function onVersionChange(listener) {
  return on(EventTypes.VERSION_CHANGE, (event) => listener(event.detail));
}

export function enableDebugLogging() {
  const unsubscribers = Object.values(EventTypes).map((type) => on(type, (event) => {
    if (typeof console !== 'undefined') {
      console.debug(`[bookkit-local] ${type}`, event.detail);
    }
  }));

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

export function getEventSourceId() {
  return SOURCE_ID;
}
