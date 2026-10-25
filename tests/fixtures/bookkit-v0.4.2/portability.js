/**
 * Bookkit Local Data Platform ΓÇö Portability (Export/Import)
 *
 * Provides portable, versioned JSON export/import with validation.
 */

const EXPORT_FORMAT = 'bookkit-local-export';
const EXPORT_VERSION = 1;

async function computeChecksum(records) {
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

function validateExportFormat(data) {
  if (!data || typeof data !== 'object') return false;
  const obj = data;
  return (
    obj.format === EXPORT_FORMAT &&
    typeof obj.version === 'number' &&
    obj.version >= 1 &&
    typeof obj.exportedAt === 'string' &&
    obj.origin && typeof obj.origin === 'object' &&
    typeof obj.origin.namespace === 'string' &&
    Array.isArray(obj.subjects) &&
    Array.isArray(obj.kinds) &&
    Array.isArray(obj.records) &&
    obj.integrity && typeof obj.integrity === 'object' &&
    typeof obj.integrity.recordCount === 'number' &&
    typeof obj.integrity.checksum === 'string'
  );
}

function validateRecord(record) {
  if (!record || typeof record !== 'object') return false;
  const r = record;
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

export async function exportRecords(store, options = {}) {
  const { listRecords } = await import('./records.js');
  const records = await listRecords(store, {
    kind: options.kinds?.[0],
    subjectId: options.subjectIds?.[0],
    limit: 100000
  });

  let filtered = records;
  if (options.kinds && options.kinds.length > 0) {
    filtered = filtered.filter(r => options.kinds.includes(r.kind));
  }
  if (options.subjectIds && options.subjectIds.length > 0) {
    filtered = filtered.filter(r => options.subjectIds.includes(r.subjectId));
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

export async function exportAndDownload(store, options = {}) {
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

export async function importRecords(store, data, options = { policy: 'merge' }) {
  const { putRecord, getRecord } = await import('./records.js');

  if (!validateExportFormat(data)) {
    throw new Error('Invalid export format: not a valid bookkit-local export');
  }

  const checksum = await computeChecksum(data.records);
  if (checksum !== data.integrity.checksum) {
    throw new Error('Import integrity check failed: checksum mismatch');
  }

  if (data.version > EXPORT_VERSION) {
    throw new Error(`Unsupported export version ${data.version} (max ${EXPORT_VERSION})`);
  }

  const targetNamespace = options.namespace || store.namespace;
  const result = { imported: 0, skipped: 0, rejected: 0, errors: [] };

  for (const record of data.records) {
    if (!validateRecord(record)) {
      result.rejected++;
      result.errors.push({ record, error: 'Invalid record structure' });
      continue;
    }

    if (record.namespace !== data.origin.namespace && !options.namespace) {
      result.rejected++;
      result.errors.push({ record, error: `Namespace mismatch: ${record.namespace} !== ${data.origin.namespace}` });
      continue;
    }

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
            break;
          case 'merge':
          default:
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

export async function importFromFile(store, file, options = { policy: 'merge' }) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file');
  }
  return importRecords(store, data, options);
}

export async function exportToMarkdown(store, subjectId) {
  const { listRecords } = await import('./records.js');

  const [notes, sources, runs, proposals] = await Promise.all([
    listRecords(store, { kind: 'note', subjectId }),
    listRecords(store, { kind: 'source', subjectId }),
    listRecords(store, { kind: 'run', subjectId }),
    listRecords(store, { kind: 'proposal', subjectId })
  ]);

  const lines = [];
  lines.push(`# Research Workspace: ${subjectId}`);
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push('');

  if (notes.length) {
    lines.push('## Notes');
    for (const note of notes) {
      const payload = note.payload;
      lines.push(`### ${note.id} (${note.updatedAt})`);
      lines.push(payload.text || '');
      lines.push('');
    }
  }

  if (sources.length) {
    lines.push('## Sources');
    for (const source of sources) {
      const payload = source.payload;
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
      const payload = run.payload;
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
      const payload = proposal.payload;
      lines.push(`### ${proposal.id} (${proposal.updatedAt})`);
      lines.push(`- **Title:** ${payload.title || 'N/A'}`);
      lines.push(`- **Status:** ${payload.status || 'draft'}`);
      if (payload.rationale) lines.push(`- **Rationale:** ${payload.rationale}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function exportMarkdownAndDownload(store, subjectId, filename) {
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
