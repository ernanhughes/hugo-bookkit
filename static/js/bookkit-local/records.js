/**
 * Bookkit Local Data Platform - generic record operations.
 *
 * A record is deliberately storage-shaped, not research-shaped:
 *
 *   { namespace, kind, id, subjectId?, schemaVersion, createdAt, updatedAt,
 *     revision, payload, provenance? }
 *
 * Application meaning lives in `payload` and in Programmer.ie's schema module.
 * All writes resolve after the IndexedDB transaction has committed.
 */

import {
  openDatabase,
  releaseDatabase,
  isConnectionClosed
} from './database.js';
import {
  ConflictError,
  ValidationError,
  DatabaseError,
  ConnectionClosedError,
  normaliseError
} from './errors.js';
import { emit, EventTypes } from './events.js';
import {
  DATABASE_VERSION,
  RECORDS_STORE
} from './migrations.js';

const NAMESPACE_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const KIND_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const MAX_PAYLOAD_BYTES = 512 * 1024;
const MAX_PROVENANCE_BYTES = 16 * 1024;
const MAX_JSON_DEPTH = 20;
const MAX_JSON_NODES = 50000;
const MAX_TEXT_LENGTH = 200000;
const MAX_SCHEMA_VERSION = 1000;

const encoder = new TextEncoder();

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nowISO() {
  return new Date().toISOString();
}

export function generateRecordId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // Fall through.
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function isValidISOTimestamp(value) {
  if (typeof value !== 'string' || !ISO_PATTERN.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function validateNamespace(namespace) {
  if (typeof namespace !== 'string' || !NAMESPACE_PATTERN.test(namespace)) {
    throw new ValidationError(
      'Namespace must be 1-64 lowercase characters: letters, numbers, dot, underscore or hyphen, starting with a letter',
      { namespace }
    );
  }
  return namespace;
}

export function validateKind(kind) {
  if (typeof kind !== 'string' || !KIND_PATTERN.test(kind)) {
    throw new ValidationError(
      'Record kind must be 1-64 lowercase characters: letters, numbers, dot, underscore or hyphen, starting with a letter',
      { kind }
    );
  }
  return kind;
}

export function validateId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new ValidationError(
      'Record id must be 1-128 characters: letters, numbers, dot, underscore, colon or hyphen',
      { id }
    );
  }
  return id;
}

function validateSubjectId(subjectId) {
  if (subjectId === undefined || subjectId === null) return undefined;
  if (typeof subjectId !== 'string' || subjectId.length === 0 || subjectId.length > 256) {
    throw new ValidationError('subjectId must be a non-empty string of at most 256 characters', { subjectId });
  }
  if (/[\u0000-\u001f\u007f]/.test(subjectId)) {
    throw new ValidationError('subjectId must not contain control characters', { subjectId });
  }
  return subjectId;
}

function cloneJSON(value, path, state, depth = 0) {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) {
    throw new ValidationError('Record payload is too complex', { path });
  }
  if (depth > MAX_JSON_DEPTH) {
    throw new ValidationError('Record payload is nested too deeply', { path });
  }

  if (value === null) return null;

  switch (typeof value) {
    case 'string':
      if (value.length > MAX_TEXT_LENGTH) {
        throw new ValidationError('A text value is too long', { path, length: value.length });
      }
      return value;
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new ValidationError('Record payload contains a non-finite number', { path });
      }
      return value;
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new ValidationError('Record payload must contain JSON data only', { path, type: typeof value });
    default:
      break;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => cloneJSON(item, `${path}[${index}]`, state, depth + 1));
  }

  if (!isPlainObject(value)) {
    throw new ValidationError('Record payload must contain plain objects and arrays only', { path });
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new ValidationError('Record payload contains a reserved key', { path, key });
    }
    if (key.length > 128) {
      throw new ValidationError('Record payload contains an overlong key', { path });
    }
    result[key] = cloneJSON(item, `${path}.${key}`, state, depth + 1);
  }
  return result;
}

/**
 * Return a detached, bounded JSON clone or throw ValidationError.
 */
export function sanitiseJSON(value, label = 'payload', maxBytes = MAX_PAYLOAD_BYTES) {
  const clone = cloneJSON(value, label, { nodes: 0 });
  let serialised;
  try {
    serialised = JSON.stringify(clone);
  } catch (error) {
    throw new ValidationError(`Record ${label} is not serialisable`, { cause: error });
  }
  const bytes = encoder.encode(serialised).length;
  if (bytes > maxBytes) {
    throw new ValidationError(
      `Record ${label} is too large (${bytes} bytes; limit ${maxBytes})`,
      { bytes, limit: maxBytes }
    );
  }
  return clone;
}

function normaliseInput(record, namespace) {
  if (!isPlainObject(record)) {
    throw new ValidationError('A record must be a plain object');
  }

  const recordNamespace = record.namespace === undefined ? namespace : record.namespace;
  if (recordNamespace !== namespace) {
    throw new ValidationError(
      `Record namespace "${recordNamespace}" does not belong to the "${namespace}" store`,
      { expected: namespace, received: recordNamespace }
    );
  }
  validateNamespace(recordNamespace);

  const kind = validateKind(record.kind);
  const id = validateId(record.id);
  const subjectId = validateSubjectId(record.subjectId);

  const schemaVersion = record.schemaVersion === undefined ? 1 : record.schemaVersion;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > MAX_SCHEMA_VERSION) {
    throw new ValidationError(
      `schemaVersion must be an integer from 1 to ${MAX_SCHEMA_VERSION}`,
      { schemaVersion }
    );
  }

  if (!isPlainObject(record.payload)) {
    throw new ValidationError('Record payload must be a plain object', { kind, id });
  }
  const payload = sanitiseJSON(record.payload, 'payload');

  let provenance;
  if (record.provenance !== undefined) {
    if (!isPlainObject(record.provenance)) {
      throw new ValidationError('Record provenance must be a plain object', { kind, id });
    }
    provenance = sanitiseJSON(record.provenance, 'provenance', MAX_PROVENANCE_BYTES);
  }

  const normalised = {
    namespace: recordNamespace,
    kind,
    id,
    schemaVersion,
    payload
  };
  if (subjectId !== undefined) normalised.subjectId = subjectId;
  if (provenance !== undefined) normalised.provenance = provenance;
  return normalised;
}

/**
 * Validate an imported envelope, including identity and timestamps that normal
 * writes generate themselves. Returns a clean envelope.
 */
export function normaliseImportedRecord(record, namespace) {
  const normalised = normaliseInput(record, namespace);

  if (!isValidISOTimestamp(record.createdAt)) {
    throw new ValidationError('Imported record has an invalid createdAt timestamp', { id: record.id });
  }
  if (!isValidISOTimestamp(record.updatedAt)) {
    throw new ValidationError('Imported record has an invalid updatedAt timestamp', { id: record.id });
  }
  if (!Number.isInteger(record.revision) || record.revision < 1) {
    throw new ValidationError('Imported record has an invalid revision', { id: record.id });
  }

  normalised.createdAt = record.createdAt;
  normalised.updatedAt = record.updatedAt;
  normalised.revision = record.revision;
  return normalised;
}

/**
 * Compatibility helper used by consumers and older examples.
 */
export function createRecord(namespace, kind, subjectId, payload, options = {}) {
  const timestamp = nowISO();
  const record = {
    namespace,
    kind,
    id: options.id || generateRecordId(),
    schemaVersion: options.schemaVersion || 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
    payload
  };
  if (subjectId !== undefined) record.subjectId = subjectId;
  if (options.provenance !== undefined) record.provenance = options.provenance;
  return record;
}

export async function openStore(config = {}) {
  const namespace = validateNamespace(config.namespace);
  const databaseName = config.databaseName || 'bookkit-local-v1';
  const version = Number(config.version || config.schemaVersion || DATABASE_VERSION);
  const { entry, upgraded, previousVersion } = await openDatabase({
    name: databaseName,
    version,
    onUpgrade: config.onUpgrade,
    onBlocked: config.onBlocked,
    onVersionChange: config.onVersionChange
  });

  const store = {
    entry,
    db: entry.db,
    namespace,
    databaseName,
    schemaVersion: entry.version,
    upgraded,
    previousVersion,
    closed: false
  };
  store.close = () => closeStore(store);
  return store;
}

export function closeStore(store) {
  if (!store || store.closed) return;
  store.closed = true;
  releaseDatabase(store.entry);
}

function assertOpen(store) {
  if (!store || store.closed || isConnectionClosed(store.entry)) {
    throw new ConnectionClosedError(store?.databaseName || 'bookkit-local-v1');
  }
}

function keyFor(store, kind, id) {
  return [store.namespace, kind, id];
}

function assertRevision(existing, expectedRevision, kind, id) {
  if (expectedRevision === undefined) return;
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new ValidationError('expectedRevision must be a non-negative integer', { expectedRevision });
  }
  if (!existing) {
    if (expectedRevision !== 0) {
      throw new ConflictError('The record no longer exists in this browser', {
        kind,
        id,
        expectedRevision,
        actualRevision: null
      });
    }
    return;
  }
  if (existing.revision !== expectedRevision) {
    throw new ConflictError('The record changed in another tab or window', {
      kind,
      id,
      expectedRevision,
      actualRevision: existing.revision
    });
  }
}

function transactionFailure(transaction, failure, operation) {
  return failure || normaliseError(transaction?.error, operation);
}

function watchTransaction(transaction, resolve, reject, operation, getResult) {
  transaction.oncomplete = () => resolve(getResult ? getResult() : undefined);
  transaction.onerror = () => reject(transactionFailure(transaction, null, operation));
  transaction.onabort = () => reject(transactionFailure(transaction, null, operation));
}

function emitCommit(record) {
  emit(EventTypes.RECORD_COMMITTED, {
    namespace: record.namespace,
    kind: record.kind,
    id: record.id,
    subjectId: record.subjectId ?? null,
    revision: record.revision,
    updatedAt: record.updatedAt
  });
}

export async function getRecord(store, kind, id) {
  assertOpen(store);
  validateKind(kind);
  validateId(id);

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = store.db.transaction(RECORDS_STORE, 'readonly');
    } catch (error) {
      reject(normaliseError(error, 'reading a record'));
      return;
    }
    const request = transaction.objectStore(RECORDS_STORE).get(keyFor(store, kind, id));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(normaliseError(request.error, 'reading a record'));
  });
}

/**
 * Upsert one record. Pass { expectedRevision } to reject a stale edit rather
 * than silently overwriting another tab's committed value.
 */
export async function putRecord(store, record, options = {}) {
  assertOpen(store);
  const input = normaliseInput(record, store.namespace);
  const expectedRevision = options.expectedRevision;
  if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
    throw new ValidationError('expectedRevision must be a non-negative integer', { expectedRevision });
  }

  let failure = null;
  let committed = null;

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = store.db.transaction(RECORDS_STORE, 'readwrite');
    } catch (error) {
      reject(normaliseError(error, 'saving a record'));
      return;
    }
    const objectStore = transaction.objectStore(RECORDS_STORE);
    const request = objectStore.get(keyFor(store, input.kind, input.id));

    request.onsuccess = () => {
      try {
        const existing = request.result || null;
        assertRevision(existing, expectedRevision, input.kind, input.id);
        const timestamp = nowISO();
        committed = {
          ...input,
          createdAt: existing?.createdAt || timestamp,
          updatedAt: timestamp,
          revision: (existing?.revision || 0) + 1
        };
        objectStore.put(committed);
      } catch (error) {
        failure = normaliseError(error, 'saving a record');
        try { transaction.abort(); } catch { /* already aborted */ }
      }
    };
    request.onerror = () => {
      failure = normaliseError(request.error, 'reading a record before saving');
      try { transaction.abort(); } catch { /* already aborted */ }
    };

    transaction.oncomplete = () => {
      if (!committed) {
        reject(new DatabaseError('Record write completed without a result', 'WRITE_INCOMPLETE'));
        return;
      }
      emitCommit(committed);
      resolve(committed);
    };
    transaction.onerror = () => reject(transactionFailure(transaction, failure, 'saving a record'));
    transaction.onabort = () => reject(transactionFailure(transaction, failure, 'saving a record'));
  });
}

export async function deleteRecord(store, kind, id, options = {}) {
  assertOpen(store);
  validateKind(kind);
  validateId(id);
  const expectedRevision = options.expectedRevision;
  if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
    throw new ValidationError('expectedRevision must be a non-negative integer', { expectedRevision });
  }

  let failure = null;
  let existed = false;
  let deleted = null;

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = store.db.transaction(RECORDS_STORE, 'readwrite');
    } catch (error) {
      reject(normaliseError(error, 'deleting a record'));
      return;
    }
    const objectStore = transaction.objectStore(RECORDS_STORE);
    const request = objectStore.get(keyFor(store, kind, id));

    request.onsuccess = () => {
      try {
        const existing = request.result || null;
        assertRevision(existing, expectedRevision, kind, id);
        if (existing) {
          existed = true;
          deleted = existing;
          objectStore.delete(keyFor(store, kind, id));
        }
      } catch (error) {
        failure = normaliseError(error, 'deleting a record');
        try { transaction.abort(); } catch { /* already aborted */ }
      }
    };
    request.onerror = () => {
      failure = normaliseError(request.error, 'reading a record before deletion');
      try { transaction.abort(); } catch { /* already aborted */ }
    };

    watchTransaction(transaction, () => {
      if (existed) {
        emit(EventTypes.RECORD_DELETED, {
          namespace: store.namespace,
          kind,
          id,
          subjectId: deleted?.subjectId ?? null,
          revision: deleted?.revision ?? null
        });
      }
      resolve(existed);
    }, reject, 'deleting a record');
  });
}

function normaliseBatchOperation(store, operation) {
  if (!operation || typeof operation !== 'object') {
    throw new ValidationError('Each batch operation must be an object');
  }

  if (operation.type === 'put') {
    const namespace = operation.namespace || store.namespace;
    const record = operation.record && typeof operation.record === 'object'
      ? { ...operation.record, namespace }
      : operation.record;
    return {
      type: 'put',
      namespace,
      record: normaliseInput(record, namespace),
      expectedRevision: operation.expectedRevision
    };
  }

  if (operation.type === 'delete') {
    return {
      type: 'delete',
      namespace: validateNamespace(operation.namespace || store.namespace),
      kind: validateKind(operation.kind),
      id: validateId(operation.id),
      expectedRevision: operation.expectedRevision
    };
  }

  throw new ValidationError('Batch operation type must be "put" or "delete"');
}

/**
 * Execute a validated list of puts/deletes in one transaction. If any request
 * fails, the transaction aborts and no operation is visible.
 */
export async function batchRecords(store, operations) {
  assertOpen(store);
  if (!Array.isArray(operations)) {
    throw new ValidationError('Batch operations must be an array');
  }
  const normalised = operations.map((operation) => normaliseBatchOperation(store, operation));
  if (normalised.length === 0) return [];

  let failure = null;
  const committed = [];

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = store.db.transaction(RECORDS_STORE, 'readwrite');
    } catch (error) {
      reject(normaliseError(error, 'writing a batch'));
      return;
    }
    const objectStore = transaction.objectStore(RECORDS_STORE);

    const abort = (error) => {
      failure = normaliseError(error, 'writing a batch');
      try { transaction.abort(); } catch { /* already aborted */ }
    };

    const enqueue = (index) => {
      if (index >= normalised.length) return;
      const operation = normalised[index];

      try {
        if (operation.type === 'delete') {
          const key = [operation.namespace, operation.kind, operation.id];
          const request = objectStore.get(key);
          request.onsuccess = () => {
            try {
              const existing = request.result || null;
              assertRevision(existing, operation.expectedRevision, operation.kind, operation.id);
              if (existing) {
                objectStore.delete(key);
                committed.push({ type: 'delete', record: existing });
              }
              enqueue(index + 1);
            } catch (error) {
              abort(error);
            }
          };
          request.onerror = () => abort(request.error);
          return;
        }

        const request = objectStore.get([
          operation.record.namespace,
          operation.record.kind,
          operation.record.id
        ]);
        request.onsuccess = () => {
          try {
            const existing = request.result || null;
            assertRevision(existing, operation.expectedRevision, operation.record.kind, operation.record.id);
            const timestamp = nowISO();
            const record = {
              ...operation.record,
              createdAt: existing?.createdAt || timestamp,
              updatedAt: timestamp,
              revision: (existing?.revision || 0) + 1
            };
            objectStore.put(record);
            committed.push({ type: 'put', record });
            enqueue(index + 1);
          } catch (error) {
            abort(error);
          }
        };
        request.onerror = () => abort(request.error);
      } catch (error) {
        abort(error);
      }
    };

    enqueue(0);

    transaction.oncomplete = () => {
      for (const operation of committed) {
        if (operation.type === 'put') emitCommit(operation.record);
        else {
          emit(EventTypes.RECORD_DELETED, {
            namespace: operation.record.namespace,
            kind: operation.record.kind,
            id: operation.record.id,
            subjectId: operation.record.subjectId ?? null,
            revision: operation.record.revision ?? null
          });
        }
      }
      resolve(committed);
    };
    transaction.onerror = () => reject(transactionFailure(transaction, failure, 'writing a batch'));
    transaction.onabort = () => reject(transactionFailure(transaction, failure, 'writing a batch'));
  });
}

export async function putMany(store, records, options = {}) {
  if (!Array.isArray(records)) throw new ValidationError('putMany expects an array');
  return batchRecords(store, records.map((record) => ({
    type: 'put',
    record,
    expectedRevision: options.expectedRevision
  })));
}

export async function deleteMany(store, items, options = {}) {
  if (!Array.isArray(items)) throw new ValidationError('deleteMany expects an array');
  return batchRecords(store, items.map((item) => ({
    type: 'delete',
    kind: item.kind,
    id: item.id,
    expectedRevision: item.expectedRevision ?? options.expectedRevision
  })));
}

function queryPlan(objectStore, namespace, kind, subjectId) {
  if (kind && subjectId) {
    return {
      index: objectStore.index('byNamespaceKindSubject'),
      range: IDBKeyRange.only([namespace, kind, subjectId])
    };
  }
  if (kind) {
    return {
      index: objectStore.index('byNamespaceKindUpdatedAt'),
      range: IDBKeyRange.bound([namespace, kind, ''], [namespace, kind, '\uffff'])
    };
  }
  if (subjectId) {
    return {
      index: objectStore.index('byNamespaceSubject'),
      range: IDBKeyRange.only([namespace, subjectId])
    };
  }
  return {
    index: objectStore.index('byNamespaceUpdatedAt'),
    range: IDBKeyRange.bound([namespace, ''], [namespace, '\uffff'])
  };
}

export async function listRecords(store, options = {}) {
  assertOpen(store);
  const kind = options.kind === undefined ? undefined : validateKind(options.kind);
  const subjectId = options.subjectId === undefined ? undefined : validateSubjectId(options.subjectId);
  const since = options.since;
  if (since !== undefined && !isValidISOTimestamp(since)) {
    throw new ValidationError('since must be an ISO 8601 timestamp');
  }

  const limit = options.limit === null || options.limit === Infinity
    ? Infinity
    : (options.limit === undefined ? 10000 : options.limit);
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 0)) {
    throw new ValidationError('limit must be a non-negative integer or null');
  }
  if (limit === 0) return [];

  const offset = options.offset === undefined ? 0 : options.offset;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ValidationError('offset must be a non-negative integer');
  }
  const order = options.order === 'asc' ? 'asc' : 'desc';

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = store.db.transaction(RECORDS_STORE, 'readonly');
    } catch (error) {
      reject(normaliseError(error, 'listing records'));
      return;
    }
    const objectStore = transaction.objectStore(RECORDS_STORE);
    const { index, range } = queryPlan(objectStore, store.namespace, kind, subjectId);
    const request = index.openCursor(range);
    const results = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        results.sort((left, right) => {
          const comparison = String(left.updatedAt).localeCompare(String(right.updatedAt));
          if (comparison !== 0) return order === 'asc' ? comparison : -comparison;
          return String(left.id).localeCompare(String(right.id));
        });
        resolve(results.slice(offset, offset + limit));
        return;
      }
      const record = cursor.value;
      if (!since || String(record.updatedAt) >= since) {
        results.push(record);
      }
      cursor.continue();
    };
    request.onerror = () => reject(normaliseError(request.error, 'listing records'));
  });
}

export async function countRecords(store, options = {}) {
  assertOpen(store);
  const kind = options.kind === undefined ? undefined : validateKind(options.kind);
  const subjectId = options.subjectId === undefined ? undefined : validateSubjectId(options.subjectId);
  const since = options.since;
  if (since !== undefined && !isValidISOTimestamp(since)) {
    throw new ValidationError('since must be an ISO 8601 timestamp');
  }

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = store.db.transaction(RECORDS_STORE, 'readonly');
    } catch (error) {
      reject(normaliseError(error, 'counting records'));
      return;
    }
    const objectStore = transaction.objectStore(RECORDS_STORE);
    const { index, range } = queryPlan(objectStore, store.namespace, kind, subjectId);

    if (!since) {
      const request = index.count(range);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(normaliseError(request.error, 'counting records'));
      return;
    }

    let count = 0;
    const request = index.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(count);
        return;
      }
      if (String(cursor.value.updatedAt) >= since) count += 1;
      cursor.continue();
    };
    request.onerror = () => reject(normaliseError(request.error, 'counting records'));
  });
}

async function deleteByCursor(store, subjectId) {
  assertOpen(store);
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = store.db.transaction(RECORDS_STORE, 'readwrite');
    } catch (error) {
      reject(normaliseError(error, 'clearing local records'));
      return;
    }
    const objectStore = transaction.objectStore(RECORDS_STORE);
    const index = subjectId
      ? objectStore.index('byNamespaceSubject')
      : objectStore.index('byNamespaceUpdatedAt');
    const range = subjectId
      ? IDBKeyRange.only([store.namespace, subjectId])
      : IDBKeyRange.bound([store.namespace, ''], [store.namespace, '\uffff']);

    let deleted = 0;
    const request = index.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      deleted += 1;
      cursor.continue();
    };
    request.onerror = () => reject(normaliseError(request.error, 'clearing local records'));

    transaction.oncomplete = () => {
      emit(EventTypes.NAMESPACE_CLEARED, {
        namespace: store.namespace,
        subjectId: subjectId ?? null,
        deleted
      });
      resolve(deleted);
    };
    transaction.onerror = () => reject(transactionFailure(transaction, null, 'clearing local records'));
    transaction.onabort = () => reject(transactionFailure(transaction, null, 'clearing local records'));
  });
}

export async function deleteSubject(store, subjectId) {
  const checked = validateSubjectId(subjectId);
  if (checked === undefined) throw new ValidationError('A subjectId is required');
  return deleteByCursor(store, checked);
}

export async function clearNamespace(store) {
  return deleteByCursor(store, undefined);
}

/**
 * Atomic import of already-validated record envelopes. Used by portability.js.
 */
export async function importNormalisedRecords(store, records, policy = 'merge') {
  assertOpen(store);
  if (!['merge', 'replace', 'skip'].includes(policy)) {
    throw new ValidationError('Import policy must be "merge", "replace" or "skip"');
  }
  if (!Array.isArray(records)) throw new ValidationError('Import records must be an array');
  if (records.length === 0) {
    return { imported: 0, skipped: 0, rejected: 0, conflicts: 0 };
  }

  let failure = null;
  const result = { imported: 0, skipped: 0, rejected: 0, conflicts: 0 };

  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = store.db.transaction(RECORDS_STORE, 'readwrite');
    } catch (error) {
      reject(normaliseError(error, 'importing records'));
      return;
    }
    const objectStore = transaction.objectStore(RECORDS_STORE);

    const abort = (error) => {
      failure = normaliseError(error, 'importing records');
      try { transaction.abort(); } catch { /* already aborted */ }
    };

    const enqueue = (index) => {
      if (index >= records.length) return;
      const incoming = records[index];
      let request;
      try {
        request = objectStore.get([store.namespace, incoming.kind, incoming.id]);
      } catch (error) {
        abort(error);
        return;
      }

      request.onsuccess = () => {
        try {
          const existing = request.result || null;
          let write = !existing;

          if (existing) {
            if (policy === 'replace') {
              write = true;
            } else if (policy === 'merge') {
              const incomingTime = Date.parse(incoming.updatedAt);
              const existingTime = Date.parse(existing.updatedAt);
              write = incoming.revision > existing.revision
                || (incoming.revision === existing.revision && incomingTime > existingTime);
            } else {
              write = false;
            }
          }

          if (!write) {
            result.skipped += 1;
            if (existing) result.conflicts += 1;
            enqueue(index + 1);
            return;
          }

          let record;
          if (existing) {
            record = {
              ...incoming,
              namespace: store.namespace,
              createdAt: existing.createdAt,
              updatedAt: Date.parse(incoming.updatedAt) > Date.parse(existing.updatedAt)
                ? incoming.updatedAt
                : nowISO(),
              revision: existing.revision + 1
            };
          } else {
            record = {
              ...incoming,
              namespace: store.namespace
            };
          }

          objectStore.put(record);
          result.imported += 1;
          enqueue(index + 1);
        } catch (error) {
          abort(error);
        }
      };
      request.onerror = () => abort(request.error);
    };

    enqueue(0);

    transaction.oncomplete = () => {
      emit(EventTypes.IMPORT_COMPLETED, {
        namespace: store.namespace,
        imported: result.imported,
        skipped: result.skipped,
        rejected: result.rejected,
        conflicts: result.conflicts
      });
      resolve(result);
    };
    transaction.onerror = () => reject(transactionFailure(transaction, failure, 'importing records'));
    transaction.onabort = () => reject(transactionFailure(transaction, failure, 'importing records'));
  });
}
