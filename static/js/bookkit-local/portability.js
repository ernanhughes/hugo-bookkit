/**
 * Bookkit Local Data Platform - portable JSON exports and imports.
 *
 * The format is application-neutral. The only application-specific decision
 * here is that a store may only import records into its own namespace. Moving
 * data between namespaces is an explicit application operation, not an
 * accidental side effect of opening a file.
 */

import {
  listRecords,
  normaliseImportedRecord,
  importNormalisedRecords,
  isValidISOTimestamp
} from './records.js';
import { ImportError, ValidationError } from './errors.js';

export const EXPORT_FORMAT = 'bookkit-local-export';
export const EXPORT_VERSION = 1;
export const MAX_EXPORT_RECORDS = 10000;
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;

const encoder = new TextEncoder();

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function checksumProjection(records) {
  return records.map((record) => ({
    namespace: record.namespace,
    kind: record.kind,
    id: record.id,
    subjectId: record.subjectId,
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    payload: record.payload
  }));
}

async function computeChecksum(records) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const data = JSON.stringify(checksumProjection(records));
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function sortRecords(records) {
  return [...records].sort((left, right) => {
    const leftKey = `${left.namespace}\u0000${left.kind}\u0000${left.id}`;
    const rightKey = `${right.namespace}\u0000${right.kind}\u0000${right.id}`;
    return leftKey.localeCompare(rightKey);
  });
}

/**
 * Export all matching records in one portable document.
 * Options: { kinds?: string[], subjectIds?: string[] }.
 */
export async function exportRecords(store, options = {}) {
  const kinds = Array.isArray(options.kinds) ? new Set(options.kinds) : null;
  const subjectIds = Array.isArray(options.subjectIds) ? new Set(options.subjectIds) : null;

  let records = await listRecords(store, { limit: null });
  if (kinds) records = records.filter((record) => kinds.has(record.kind));
  if (subjectIds) records = records.filter((record) => subjectIds.has(record.subjectId));
  records = sortRecords(records);

  if (records.length > MAX_EXPORT_RECORDS) {
    throw new ValidationError(
      `Too many records to export (${records.length}; limit ${MAX_EXPORT_RECORDS})`
    );
  }

  const serialised = JSON.stringify(records);
  if (encoder.encode(serialised).length > MAX_EXPORT_BYTES) {
    throw new ValidationError('The selected records are too large to export in one file');
  }

  const checksum = await computeChecksum(records);
  const integrity = { recordCount: records.length };
  if (checksum) integrity.checksum = checksum;

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    origin: {
      namespace: store.namespace,
      application: 'bookkit-local'
    },
    subjects: [...new Set(records.map((record) => record.subjectId).filter(Boolean))],
    kinds: [...new Set(records.map((record) => record.kind))],
    records,
    integrity
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadExport(store, options = {}) {
  const data = await exportRecords(store, options);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const filename = options.filename || `bookkit-local-${store.namespace}-${Date.now()}.json`;
  downloadBlob(blob, filename);
  return data;
}

export const exportAndDownload = downloadExport;

/**
 * Validate and normalise an export document. Throws ImportError for malformed,
 * unsupported, oversized, duplicate or unsafe input. Returns normalised records.
 */
export async function validateExportData(data, options = {}) {
  if (!isPlainObject(data)) {
    throw new ImportError('Import must be a JSON object');
  }
  if (data.format !== EXPORT_FORMAT) {
    throw new ImportError(`Unsupported import format: ${String(data.format)}`);
  }
  if (!Number.isInteger(data.version) || data.version < 1) {
    throw new ImportError('Import format version is missing or invalid');
  }
  if (data.version > EXPORT_VERSION) {
    throw new ImportError(
      `This export uses format version ${data.version}, but this site supports version ${EXPORT_VERSION}. Update the site before importing.`
    );
  }
  if (!isValidISOTimestamp(data.exportedAt)) {
    throw new ImportError('Import has an invalid exportedAt timestamp');
  }
  if (!isPlainObject(data.origin) || typeof data.origin.namespace !== 'string') {
    throw new ImportError('Import is missing its origin namespace');
  }
  if (options.namespace && data.origin.namespace !== options.namespace) {
    throw new ImportError(
      `This export belongs to the "${data.origin.namespace}" namespace, not "${options.namespace}"`
    );
  }
  if (!Array.isArray(data.records)) {
    throw new ImportError('Import records must be an array');
  }
  if (data.records.length > MAX_EXPORT_RECORDS) {
    throw new ImportError(
      `Import contains too many records (${data.records.length}; limit ${MAX_EXPORT_RECORDS})`
    );
  }
  if (!isPlainObject(data.integrity) || !Number.isInteger(data.integrity.recordCount)) {
    throw new ImportError('Import is missing its integrity metadata');
  }
  if (data.integrity.recordCount !== data.records.length) {
    throw new ImportError('Import record count does not match its integrity metadata');
  }

  const serialised = JSON.stringify(data.records);
  if (encoder.encode(serialised).length > MAX_EXPORT_BYTES) {
    throw new ImportError('Import is too large');
  }

  const namespace = options.namespace || data.origin.namespace;
  const seen = new Set();
  const records = data.records.map((record) => {
    if (!isPlainObject(record)) {
      throw new ImportError('Every imported record must be an object');
    }
    if (record.namespace !== data.origin.namespace) {
      throw new ImportError(
        `Record namespace "${record.namespace}" does not match export origin "${data.origin.namespace}"`
      );
    }
    const normalised = normaliseImportedRecord(record, namespace);
    const key = `${normalised.kind}\u0000${normalised.id}`;
    if (seen.has(key)) {
      throw new ImportError(`Import contains a duplicate record: ${normalised.kind}/${normalised.id}`);
    }
    seen.add(key);
    return normalised;
  });

  if (typeof data.integrity.checksum === 'string' && data.integrity.checksum.length > 0) {
    const actual = await computeChecksum(records);
    if (!actual) {
      throw new ImportError('This browser cannot verify the import checksum; try a current browser over HTTPS or localhost');
    }
    if (actual !== data.integrity.checksum) {
      throw new ImportError('Import integrity check failed: checksum mismatch');
    }
  }

  return records;
}

/**
 * Import a validated document atomically. Conflict policies:
 *   merge   - write only if the incoming revision is newer (default)
 *   replace - overwrite existing records
 *   skip    - never overwrite an existing record
 */
export async function importRecords(store, data, options = {}) {
  const policy = options.policy || 'merge';
  const records = await validateExportData(data, { namespace: store.namespace });
  return importNormalisedRecords(store, records, policy);
}

export async function importFromFile(store, file, options = {}) {
  if (!file || typeof file.text !== 'function') {
    throw new ImportError('Choose a JSON export file to import');
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new ImportError(
      `Import file is too large (${file.size} bytes; limit ${MAX_IMPORT_FILE_BYTES})`
    );
  }

  let text;
  try {
    text = await file.text();
  } catch {
    throw new ImportError('The selected file could not be read');
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('The selected file is not valid JSON');
  }

  return importRecords(store, data, options);
}
