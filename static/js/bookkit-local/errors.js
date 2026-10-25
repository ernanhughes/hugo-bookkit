/**
 * Bookkit Local Data Platform - error contracts.
 *
 * Every failure that crosses the public API is a BookkitLocalError so callers
 * can branch on `code` without parsing browser-specific IndexedDB messages.
 */

export class BookkitLocalError extends Error {
  constructor(message, code, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (options.cause) this.cause = options.cause;
    if (options.details !== undefined) this.details = options.details;
  }
}

export class DatabaseError extends BookkitLocalError {
  constructor(message, code = 'DATABASE_ERROR', cause) {
    super(message, code, { cause });
  }
}

export class StorageUnavailableError extends DatabaseError {
  constructor(reason) {
    super(`Browser storage unavailable: ${reason}`, 'STORAGE_UNAVAILABLE');
  }
}

export class QuotaExceededError extends DatabaseError {
  constructor(cause) {
    super('Browser storage quota exceeded', 'QUOTA_EXCEEDED', cause);
  }
}

export class UpgradeBlockedError extends DatabaseError {
  constructor(oldVersion, newVersion, cause) {
    super(
      `Database upgrade from v${oldVersion} to v${newVersion} is blocked by another open tab`,
      'UPGRADE_BLOCKED',
      cause
    );
    this.oldVersion = oldVersion;
    this.newVersion = newVersion;
  }
}

export class VersionMismatchError extends DatabaseError {
  constructor(databaseName, currentVersion, requestedVersion) {
    super(
      `The "${databaseName}" database is at schema v${currentVersion}, but this page requested v${requestedVersion}. Reload the page to use the current version.`,
      'VERSION_MISMATCH'
    );
    this.databaseName = databaseName;
    this.currentVersion = currentVersion;
    this.requestedVersion = requestedVersion;
  }
}

export class ConnectionClosedError extends DatabaseError {
  constructor(databaseName) {
    super(
      `The "${databaseName}" database connection is closed. Reload the page to reconnect.`,
      'CONNECTION_CLOSED'
    );
    this.databaseName = databaseName;
  }
}

export class ValidationError extends BookkitLocalError {
  constructor(message, details) {
    super(message, 'VALIDATION_ERROR', { details });
  }
}

export class ConflictError extends BookkitLocalError {
  constructor(message, details) {
    super(message, 'CONFLICT', { details });
  }
}

export class ImportError extends ValidationError {
  constructor(message, details) {
    super(message, details);
    this.name = 'ImportError';
    this.code = 'IMPORT_REJECTED';
  }
}

/**
 * Translate a DOMException from IndexedDB into a stable API error.
 * A BookkitLocalError passes through unchanged.
 */
export function normaliseError(error, context = 'operation') {
  if (error instanceof BookkitLocalError) return error;
  if (!error) return new DatabaseError(`Unknown failure during ${context}`, 'UNKNOWN_ERROR');

  const name = error.name || '';
  const message = error.message || String(error);

  switch (name) {
    case 'QuotaExceededError':
      return new QuotaExceededError(error);
    case 'SecurityError':
      return new StorageUnavailableError(`security restriction during ${context}`);
    case 'VersionError':
      return new VersionMismatchError('bookkit-local', 'newer', 'this page');
    case 'InvalidStateError':
      return new ConnectionClosedError('bookkit-local');
    case 'DataCloneError':
      return new ValidationError(`A record could not be stored because it contains non-portable data during ${context}`, {
        cause: error
      });
    case 'ConstraintError':
      return new DatabaseError(`A storage constraint rejected the ${context}`, 'CONSTRAINT_ERROR', error);
    case 'AbortError':
      return new DatabaseError(`The ${context} was aborted`, 'TRANSACTION_ABORTED', error);
    default:
      return new DatabaseError(message || `IndexedDB failed during ${context}`, 'STORAGE_ERROR', error);
  }
}

export function isConflict(error) {
  return error instanceof BookkitLocalError && error.code === 'CONFLICT';
}
