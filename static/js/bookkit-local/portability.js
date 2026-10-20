/**
 * Bookkit Local Data Platform — Portability (Export/Import)
 *
 * Provides portable, versioned JSON export/import with validation.
 */
import type { RecordEnvelope } from './records.js';

export interface ExportFormat {
  format: 'bookkit-local-export';
  version: number;
  exportedAt: string;
  origin: {
    namespace: string;
    application?: string;
  };
  subjects: string[];
  kinds: string[];
  records: RecordEnvelope[];
  integrity: {
    recordCount: number;
    checksum: string;
  };
}

export interface ImportOptions {
  policy: 'merge' | 'replace' | 'skip';
  namespace?: string; // Override namespace on import
}

export interface ImportResult {
  imported: number;
  skipped: number;
  rejected: number;
  errors: Array<{ record: RecordEnvelope; error: string }>;
}

const EXPORT_FORMAT = 'bookkit-local-export';
const EXPORT_VERSION = 1;

/**
 * Compute a simple checksum for integrity verification.
 */
async function computeChecksum(records: RecordEnvelope[]): Promise<string> {
  const data = JSON.stringify(records.map(r => ({
    namespace: r.namespace,
    kind: r.kind,
    id: r.id,
    subjectId: r.subjectId,
    schemaVersion: r.schemaVersion,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    payload: r.payload
  })));

  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(buffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate an export format object.
 */
function validateExportFormat(data: unknown): data is ExportFormat {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.format === EXPORT_FORMAT &&
    typeof obj.version === 'number' &&
    obj.version >= 1 &&
    typeof obj.exportedAt === 'string' &&
    obj.origin && typeof obj.origin === 'object' &&
    typeof (obj.origin as Record<string, unknown>).namespace === 'string' &&
    Array.isArray(obj.subjects) &&
    Array.isArray(obj.kinds) &&
    Array.isArray(obj.records) &&
    obj.integrity && typeof obj.integrity === 'object' &&
    typeof (obj.integrity as Record<string, unknown>).recordCount === 'number' &&
    typeof (obj.integrity as Record<string, unknown>).checksum === 'string'
  );
}

/**
 * Validate a single record envelope.
 */
function validateRecord(record: unknown): record is RecordEnvelope {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  return (
    typeof r.namespace === 'string' &&
    typeof r.kind === 'string' &&
    typeof r.id === 'string' &&
    typeof r.subjectId === 'string' &&
    typeof r.schemaVersion === 'number' &&
    typeof r.createdAt === 'string' &&
    typeof r.updatedAt === 'string' &&
    r.payload !== undefined
  );
}

/**
 * Export records to a portable JSON format.
 */
export async function exportRecords(
  store: { db: IDBDatabase; namespace: string },
  options: { kinds?: string[]; subjectIds?: string[] } = {}
): Promise<ExportFormat> {
  const { listRecords } = await import('./records.js');
  const records = await listRecords(store, {
    kind: options.kinds?.[0], // listRecords only supports single kind; we'll filter after
    subjectId: options.subjectIds?.[0],
    limit: 100000
  });

  // Filter by kinds and subjectIds if specified
  let filtered = records;
  if (options.kinds && options.kinds.length > 0) {
    filtered = filtered.filter(r => options.kinds!.includes(r.kind));
  }
  if (options.subjectIds && options.subjectIds.length > 0) {
    filtered = filtered.filter(r => options.subjectIds!.includes(r.subjectId));
  }

  const subjects = [...new Set(filtered.map(r => r.subjectId))];
  const kinds = [...new Set(filtered.map(r => r.kind))];
  const checksum = await computeChecksum(filtered);

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    origin: {
      namespace: store.namespace,
      application: 'bookkit-local'
    },
    subjects,
    kinds,
    records: filtered,
    integrity: {
      recordCount: filtered.length,
      checksum
    }
  };
}

/**
 * Export records and trigger a download.
 */
export async function exportAndDownload(
  store: { db: IDBDatabase; namespace: string },
  options: { kinds?: string[]; subjectIds?: string[]; filename?: string } = {}
): Promise<void> {
  const exportData = await exportRecords(store, options);
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const filename = options.filename || `bookkit-local-${store.namespace}-${Date.now()}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Import records from a portable JSON format.
 */
export async function importRecords(
  store: { db: IDBDatabase; namespace: string },
  data: unknown,
  options: ImportOptions = { policy: 'merge' }
): Promise<ImportResult> {
  const { putRecord, getRecord } = await import('./records.js');

  if (!validateExportFormat(data)) {
    throw new Error('Invalid export format: not a valid bookkit-local export');
  }

  // Verify checksum
  const checksum = await computeChecksum(data.records);
  if (checksum !== data.integrity.checksum) {
    throw new Error('Import integrity check failed: checksum mismatch');
  }

  // Check version compatibility
  if (data.version > EXPORT_VERSION) {
    throw new Error(`Unsupported export version ${data.version} (max ${EXPORT_VERSION})`);
  }

  const targetNamespace = options.namespace || store.namespace;
  const result: ImportResult = { imported: 0, skipped: 0, rejected: 0, errors: [] };

  for (const record of data.records) {
    if (!validateRecord(record)) {
      result.rejected++;
      result.errors.push({ record: record as RecordEnvelope, error: 'Invalid record structure' });
      continue;
    }

    // Namespace check
    if (record.namespace !== data.origin.namespace && !options.namespace) {
      result.rejected++;
      result.errors.push({ record, error: `Namespace mismatch: ${record.namespace} !== ${data.origin.namespace}` });
      continue;
    }

    // Apply namespace override if specified
    const recordToImport = options.namespace
      ? { ...record, namespace: options.namespace }
      : record;

    try {
      const existing = await getRecord(store, recordToImport.kind, recordToImport.id);

      if (existing) {
        const existingTime = new Date(existing.updatedAt).getTime();
        const incomingTime = new Date(recordToImport.updatedAt).getTime();

        switch (options.policy) {
          case 'skip':
            result.skipped++;
            continue;
          case 'replace':
            // Always replace
            break;
          case 'merge':
          default:
            // Newer wins
            if (incomingTime <= existingTime) {
              result.skipped++;
              continue;
            }
            break;
        }
      }

      await putRecord(store, recordToImport);
      result.imported++;
    } catch (error) {
      result.rejected++;
      result.errors.push({
        record: recordToImport,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return result;
}

/**
 * Import from a file input.
 */
export async function importFromFile(
  store: { db: IDBDatabase; namespace: string },
  file: File,
  options: ImportOptions = { policy: 'merge' }
): Promise<ImportResult> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file');
  }
  return importRecords(store, data, options);
}

/**
 * Export to Markdown (for research workspace).
 * This is a research-specific convenience, not generic.
 */
export async function exportToMarkdown(
  store: { db: IDBDatabase; namespace: string },
  subjectId: string
): Promise<string> {
  const { listRecords } = await import('./records.js');

  const [notes, sources, runs, proposals] = await Promise.all([
    listRecords(store, { kind: 'note', subjectId }),
    listRecords(store, { kind: 'source', subjectId }),
    listRecords(store, { kind: 'run', subjectId }),
    listRecords(store, { kind: 'proposal', subjectId })
  ]);

  const lines: string[] = [];
  lines.push(`# Research Workspace: ${subjectId}`);
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push('');

  if (notes.length) {
    lines.push('## Notes');
    for (const note of notes) {
      const payload = note.payload as { text?: string; [key: string]: unknown };
      lines.push(`### ${note.id} (${note.updatedAt})`);
      lines.push(payload.text || '');
      lines.push('');
    }
  }

  if (sources.length) {
    lines.push('## Sources');
    for (const source of sources) {
      const payload = source.payload as { url?: string; title?: string; readingStatus?: string; notes?: string };
      lines.push(`### ${source.id}`);
      lines.push(`- **URL:** ${payload.url || 'N/A'}`);
      lines.push(`- **Title:** ${payload.title || 'N/A'}`);
      lines.push(`- **Status:** ${payload.readingStatus || 'N/A'}`);
      if (payload.notes) lines.push(`- **Notes:** ${payload.notes}`);
      lines.push('');
    }
  }

  if (runs.length) {
    lines.push('## Research Runs');
    for (const run of runs) {
      const payload = run.payload as { status?: string; method?: string; summary?: string; chapterFingerprint?: string };
      lines.push(`### ${run.id} (${run.updatedAt})`);
      lines.push(`- **Status:** ${payload.status || 'N/A'}`);
      lines.push(`- **Method:** ${payload.method || 'N/A'}`);
      lines.push(`- **Fingerprint:** ${payload.chapterFingerprint || 'N/A'}`);
      if (payload.summary) lines.push(`- **Summary:** ${payload.summary}`);
      lines.push('');
    }
  }

  if (proposals.length) {
    lines.push('## Proposals');
    for (const proposal of proposals) {
      const payload = proposal.payload as { title?: string; rationale?: string; status?: string };
      lines.push(`### ${proposal.id} (${proposal.updatedAt})`);
      lines.push(`- **Title:** ${payload.title || 'N/A'}`);
      lines.push(`- **Status:** ${payload.status || 'draft'}`);
      if (payload.rationale) lines.push(`- **Rationale:** ${payload.rationale}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Export to Markdown and trigger download.
 */
export async function exportMarkdownAndDownload(
  store: { db: IDBDatabase; namespace: string },
  subjectId: string,
  filename?: string
): Promise<void> {
  const markdown = await exportToMarkdown(store, subjectId);
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  const downloadFilename = filename || `research-${subjectId}-${Date.now()}.md`;

  const a = document.createElement('a');
  a.href = url;
  a.download = downloadFilename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}