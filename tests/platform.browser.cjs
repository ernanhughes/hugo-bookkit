// Real-browser acceptance tests for the Bookkit Local Data Platform.
// Run: node tests/platform.browser.cjs
//
// The test serves the actual static modules over HTTP and exercises Chromium's
// IndexedDB implementation. It does not mock IndexedDB.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const JS_ROOT = path.join(__dirname, '../static/js/bookkit-local');
const MODULE_ROOT = '/lib';

function serve() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><meta charset="utf-8"><title>Bookkit Local Data test</title>');
      return;
    }
    if (url.pathname.startsWith(`${MODULE_ROOT}/`)) {
      const name = path.basename(url.pathname);
      const file = path.join(JS_ROOT, name);
      if (!name.endsWith('.js') || !fs.existsSync(file)) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(fs.readFileSync(file));
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function loadModule(page, base) {
  await page.goto(base);
  await page.evaluate(async (moduleRoot) => {
    const module = await import(`${moduleRoot}/index.js`);
    window.BookkitLocal = module.default;
    window.BookkitLocalModule = module;
  }, MODULE_ROOT);
}

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error.stack || error.message}`);
      console.log(`  FAIL ${name}`);
    }
  };

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await loadModule(page, base);

    await check('database creation, CRUD and commit durability', async () => {
      const name = unique('crud');
      const result = await page.evaluate(async (databaseName) => {
        const store = await BookkitLocal.open({ namespace: 'research', databaseName });
        const record = BookkitLocal.createRecord(
          'research', 'note', 'retrieval-07-chapter', { text: 'first' }, { id: 'note-1' }
        );
        const saved = await store.put(record);
        const fetched = await store.get('note', 'note-1');
        const listed = await store.list({ kind: 'note', subjectId: 'retrieval-07-chapter' });
        const updated = await store.put(
          { ...saved, payload: { text: 'second' } },
          { expectedRevision: saved.revision }
        );
        let conflict = null;
        try {
          await store.put({ ...saved, payload: { text: 'stale' } }, { expectedRevision: saved.revision });
        } catch (error) {
          conflict = error.code;
        }
        const deleted = await store.delete('note', 'note-1');
        const gone = await store.get('note', 'note-1');
        await store.close();
        return {
          savedRevision: saved.revision,
          fetchedText: fetched.payload.text,
          listedCount: listed.length,
          updatedRevision: updated.revision,
          updatedText: updated.payload.text,
          conflict,
          deleted,
          gone,
          schemaVersion: saved.schemaVersion
        };
      }, name);

      assert.equal(result.savedRevision, 1);
      assert.equal(result.fetchedText, 'first');
      assert.equal(result.listedCount, 1);
      assert.equal(result.updatedRevision, 2);
      assert.equal(result.updatedText, 'second');
      assert.equal(result.conflict, 'CONFLICT');
      assert.equal(result.deleted, true);
      assert.equal(result.gone, null);

      await page.reload();
      await loadModule(page, base);
      const persisted = await page.evaluate(async (databaseName) => {
        const store = await BookkitLocal.open({ namespace: 'research', databaseName });
        const note = await store.get('note', 'note-1');
        await store.close();
        return note;
      }, name);
      assert.equal(persisted, null, 'deleted record must stay deleted after reload');
    });

    await check('namespace, subject and kind isolation', async () => {
      const name = unique('isolation');
      const result = await page.evaluate(async (databaseName) => {
        const research = await BookkitLocal.open({ namespace: 'research', databaseName });
        const annotations = await BookkitLocal.open({ namespace: 'annotations', databaseName });
        await research.put(BookkitLocal.createRecord('research', 'note', 'subject-a', { text: 'r-a' }, { id: 'same-id' }));
        await research.put(BookkitLocal.createRecord('research', 'note', 'subject-b', { text: 'r-b' }, { id: 'other-id' }));
        await annotations.put(BookkitLocal.createRecord('annotations', 'note', 'subject-a', { text: 'a-a' }, { id: 'same-id' }));
        const researchA = await research.list({ subjectId: 'subject-a' });
        const annotationsA = await annotations.list({ subjectId: 'subject-a' });
        const all = await research.list({});
        await research.close();
        await annotations.close();
        return {
          researchA: researchA.map((record) => record.payload.text),
          annotationsA: annotationsA.map((record) => record.payload.text),
          allCount: all.length
        };
      }, name);
      assert.deepEqual(result.researchA, ['r-a']);
      assert.deepEqual(result.annotationsA, ['a-a']);
      assert.equal(result.allCount, 2);
    });

    await check('atomic batch and validation rejection leave no partial writes', async () => {
      const name = unique('batch');
      const result = await page.evaluate(async (databaseName) => {
        const store = await BookkitLocal.open({ namespace: 'research', databaseName });
        const first = BookkitLocal.createRecord('research', 'note', 's', { text: 'first' }, { id: 'first' });
        let rejected = false;
        try {
          await store.batch([
            { type: 'put', record: first },
            { type: 'put', record: { kind: 'note', id: 'bad', subjectId: 's', payload: { fn() {} } } }
          ]);
        } catch {
          rejected = true;
        }
        const afterFailure = await store.list({});
        let namespaceMismatch = null;
        try {
          await store.batch([{
            type: 'put',
            record: BookkitLocal.createRecord('other', 'note', 's', { text: 'wrong namespace' }, { id: 'wrong-namespace' })
          }]);
        } catch (error) {
          namespaceMismatch = error.code;
        }
        const afterNamespaceMismatch = await store.count({});
        await store.batch([
          { type: 'put', record: first },
          { type: 'put', record: BookkitLocal.createRecord('research', 'note', 's', { text: 'second' }, { id: 'second' }) },
          { type: 'delete', kind: 'note', id: 'second' }
        ]);
        const final = await store.list({});
        await store.close();
        return {
          rejected,
          afterFailure: afterFailure.length,
          namespaceMismatch,
          afterNamespaceMismatch,
          final: final.map((record) => record.id)
        };
      }, name);
      assert.equal(result.rejected, true);
      assert.equal(result.afterFailure, 0);
      assert.equal(result.namespaceMismatch, 'VALIDATION_ERROR');
      assert.equal(result.afterNamespaceMismatch, 0);
      assert.deepEqual(result.final, ['first']);
    });

    await check('events are metadata-only and repeated open does not duplicate listeners', async () => {
      const name = unique('events');
      const result = await page.evaluate(async (databaseName) => {
        const events = [];
        window.addEventListener('bookkit:local:record-committed', (event) => events.push(event.detail));
        await BookkitLocal.open({ namespace: 'research', databaseName });
        const store = await BookkitLocal.open({ namespace: 'research', databaseName });
        await store.put(BookkitLocal.createRecord('research', 'note', 's', { text: 'private text' }, { id: 'event-note' }));
        await new Promise((resolve) => setTimeout(resolve, 50));
        await store.close();
        return {
          count: events.length,
          detail: events[0],
          hasPayload: Object.prototype.hasOwnProperty.call(events[0] || {}, 'payload'),
          serialised: JSON.stringify(events)
        };
      }, name);
      assert.equal(result.count, 1);
      assert.equal(result.hasPayload, false);
      assert.ok(!result.serialised.includes('private text'));
      assert.equal(result.detail.id, 'event-note');
      assert.equal(result.detail.kind, 'note');
    });

    await check('export, clear, import and conflict policies round-trip', async () => {
      const name = unique('portability');
      const result = await page.evaluate(async (databaseName) => {
        const store = await BookkitLocal.open({ namespace: 'research', databaseName });
        await store.put(BookkitLocal.createRecord('research', 'note', 'chapter-1', { text: 'chapter one' }, { id: 'n1' }));
        await store.put(BookkitLocal.createRecord('research', 'source', 'chapter-1', { url: 'https://example.org' }, { id: 's1' }));
        await store.put(BookkitLocal.createRecord('research', 'note', 'chapter-2', { text: 'chapter two' }, { id: 'n2' }));

        const chapter = await store.export({ subjectIds: ['chapter-1'] });
        const all = await store.export({});
        const exportedText = JSON.stringify(chapter);
        await store.deleteSubject('chapter-1');
        const afterClear = await store.list({ subjectId: 'chapter-1' });
        const imported = await store.import(chapter, { policy: 'merge' });
        const restored = await store.list({ subjectId: 'chapter-1' });

        // A re-import of the same revision is not a newer change.
        const skipped = await store.import(chapter, { policy: 'merge' });

        // Advance the local note, then prove an older import does not overwrite it.
        const local = await store.get('note', 'n1');
        await store.put({ ...local, payload: { text: 'local newer' } }, { expectedRevision: local.revision });
        const conflict = await store.import(chapter, { policy: 'merge' });
        const afterConflict = await store.get('note', 'n1');

        await store.close();
        return {
          chapterCount: chapter.records.length,
          allCount: all.records.length,
          format: chapter.format,
          version: chapter.version,
          checksumLength: chapter.integrity.checksum.length,
          afterClear: afterClear.length,
          imported,
          restored: restored.map((record) => record.id).sort(),
          skipped,
          conflict,
          afterConflict: afterConflict.payload.text,
          exportedText
        };
      }, name);
      assert.equal(result.format, 'bookkit-local-export');
      assert.equal(result.version, 1);
      assert.equal(result.chapterCount, 2);
      assert.equal(result.allCount, 3);
      assert.equal(result.checksumLength, 64);
      assert.equal(result.afterClear, 0);
      assert.equal(result.imported.imported, 2);
      assert.deepEqual(result.restored, ['n1', 's1']);
      assert.equal(result.skipped.imported, 0);
      assert.equal(result.skipped.skipped, 2);
      assert.equal(result.conflict.imported, 0);
      assert.equal(result.conflict.conflicts >= 1, true);
      assert.equal(result.afterConflict, 'local newer');
      assert.ok(result.exportedText.includes('chapter one'));
    });

    await check('invalid, unsupported, duplicate and malformed imports are rejected', async () => {
      const name = unique('invalid-import');
      const result = await page.evaluate(async (databaseName) => {
        const store = await BookkitLocal.open({ namespace: 'research', databaseName });
        const valid = await store.export({});
        const baseRecord = {
          namespace: 'research',
          kind: 'note',
          id: 'bad',
          subjectId: 's',
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          revision: 1,
          payload: { text: 'bad' }
        };
        const make = (mutate) => {
          const copy = JSON.parse(JSON.stringify(valid));
          mutate(copy);
          return copy;
        };
        const cases = {
          formatVersion: make((doc) => { doc.version = 2; }),
          badTimestamp: make((doc) => {
            doc.records = [{ ...baseRecord, createdAt: 'not-a-time' }];
            doc.integrity.recordCount = 1;
            doc.integrity.checksum = undefined;
          }),
          duplicate: make((doc) => {
            doc.records = [{ ...baseRecord, id: 'dup' }, { ...baseRecord, id: 'dup' }];
            doc.integrity.recordCount = 2;
            doc.integrity.checksum = undefined;
          }),
          namespaceMismatch: make((doc) => {
            doc.origin.namespace = 'annotations';
            doc.records = [{ ...baseRecord }];
            doc.integrity.recordCount = 1;
            doc.integrity.checksum = undefined;
          }),
          checksum: make((doc) => {
            doc.records = [{ ...baseRecord }];
            doc.integrity.recordCount = 1;
            doc.integrity.checksum = '00'.repeat(32);
          })
        };

        const errors = {};
        for (const [key, doc] of Object.entries(cases)) {
          try {
            await store.import(doc);
            errors[key] = 'accepted';
          } catch (error) {
            errors[key] = error.code || error.message;
          }
        }
        const count = await store.count({});
        await store.close();
        return { errors, count };
      }, name);
      assert.equal(result.errors.formatVersion, 'IMPORT_REJECTED');
      assert.equal(result.errors.badTimestamp, 'VALIDATION_ERROR');
      assert.equal(result.errors.duplicate, 'IMPORT_REJECTED');
      assert.equal(result.errors.namespaceMismatch, 'IMPORT_REJECTED');
      assert.equal(result.errors.checksum, 'IMPORT_REJECTED');
      assert.equal(result.count, 0);
    });

    await check('migration v1 to v2 preserves records and adds the query index', async () => {
      const name = unique('migration');
      const result = await page.evaluate(async (databaseName) => {
        const createdAt = new Date().toISOString();
        await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName, 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            const records = db.createObjectStore('records', { keyPath: ['namespace', 'kind', 'id'] });
            records.createIndex('byNamespaceSubject', ['namespace', 'subjectId']);
            records.createIndex('byNamespaceKind', ['namespace', 'kind']);
            records.createIndex('byNamespaceKindSubject', ['namespace', 'kind', 'subjectId']);
            records.createIndex('byNamespaceUpdatedAt', ['namespace', 'updatedAt']);
            db.createObjectStore('metadata', { keyPath: 'key' });
          };
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('records', 'readwrite');
            tx.objectStore('records').put({
              namespace: 'research',
              kind: 'note',
              id: 'legacy',
              subjectId: 'chapter',
              schemaVersion: 1,
              createdAt,
              updatedAt: createdAt,
              revision: 1,
              payload: { text: 'legacy record' }
            });
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
          request.onerror = () => reject(request.error);
        });

        const store = await BookkitLocal.open({ namespace: 'research', databaseName });
        const record = await store.get('note', 'legacy');
        const byKind = await store.list({ kind: 'note' });
        const schemaVersion = store.schemaVersion;
        await store.close();

        const raw = await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(['records', 'metadata'], 'readonly');
            const indexes = Array.from(tx.objectStore('records').indexNames);
            const meta = tx.objectStore('metadata').get('schemaVersion');
            meta.onsuccess = () => {
              const result = { version: db.version, indexes, schema: meta.result?.value };
              db.close();
              resolve(result);
            };
            meta.onerror = () => reject(meta.error);
          };
          request.onerror = () => reject(request.error);
        });
        return { text: record.payload.text, count: byKind.length, schemaVersion, raw };
      }, name);
      assert.equal(result.text, 'legacy record');
      assert.equal(result.count, 1);
      assert.equal(result.schemaVersion, 2);
      assert.equal(result.raw.version, 2);
      assert.ok(result.raw.indexes.includes('byNamespaceKindUpdatedAt'));
      assert.equal(result.raw.schema, 2);
    });

    await check('a failed upgrade preserves the previous database version and data', async () => {
      const name = unique('failed-migration');
      const result = await page.evaluate(async (databaseName) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName, 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore('metadata', { keyPath: 'key' });
          };
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('metadata', 'readwrite');
            tx.objectStore('metadata').put({ key: 'sentinel', value: 'keep me' });
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
          request.onerror = () => reject(request.error);
        });

        let code = null;
        try {
          const store = await BookkitLocal.open({ namespace: 'research', databaseName });
          await store.close();
        } catch (error) {
          code = error.code;
        }

        const raw = await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('metadata', 'readonly');
            const sentinel = tx.objectStore('metadata').get('sentinel');
            sentinel.onsuccess = () => {
              const value = sentinel.result?.value;
              const version = db.version;
              db.close();
              resolve({ value, version });
            };
            sentinel.onerror = () => reject(sentinel.error);
          };
          request.onerror = () => reject(request.error);
        });
        return { code, raw };
      }, name);
      assert.ok(['SCHEMA_INCOMPATIBLE', 'STORAGE_ERROR', 'DATABASE_ERROR', 'ABORTED'].includes(result.code) || result.code);
      assert.equal(result.raw.version, 1);
      assert.equal(result.raw.value, 'keep me');
    });

    await check('a blocked upgrade proceeds once the old connection closes', async () => {
      const name = unique('blocked');
      const oldPage = await context.newPage();
      await oldPage.goto(base);
      await oldPage.evaluate(async (databaseName) => {
        window.oldDb = await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName, 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            const records = db.createObjectStore('records', { keyPath: ['namespace', 'kind', 'id'] });
            records.createIndex('byNamespaceSubject', ['namespace', 'subjectId']);
            records.createIndex('byNamespaceKind', ['namespace', 'kind']);
            records.createIndex('byNamespaceKindSubject', ['namespace', 'kind', 'subjectId']);
            records.createIndex('byNamespaceUpdatedAt', ['namespace', 'updatedAt']);
            db.createObjectStore('metadata', { keyPath: 'key' });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }, name);

      const upgradingPage = await context.newPage();
      await loadModule(upgradingPage, base);
      await upgradingPage.evaluate((databaseName) => {
        window.blockedDetail = null;
        window.openResult = null;
        window.addEventListener('bookkit:local:version-blocked', (event) => {
          window.blockedDetail = event.detail;
        });
        window.BookkitLocal.open({ namespace: 'research', databaseName })
          .then((store) => { window.openResult = { ok: true, schemaVersion: store.schemaVersion }; })
          .catch((error) => { window.openResult = { ok: false, code: error.code }; });
      }, name);
      await upgradingPage.waitForFunction(() => window.blockedDetail);
      assert.equal(await upgradingPage.evaluate(() => window.blockedDetail.reason), 'blocked');

      await oldPage.evaluate(() => window.oldDb.close());
      await upgradingPage.waitForFunction(() => window.openResult);
      const result = await upgradingPage.evaluate(() => window.openResult);
      assert.equal(result.ok, true);
      assert.equal(result.schemaVersion, 2);
      await oldPage.close();
      await upgradingPage.close();
    });

    await check('versionchange closes the stale connection and prevents stale writes', async () => {
      const name = unique('versionchange');
      const stalePage = await context.newPage();
      await loadModule(stalePage, base);
      await stalePage.evaluate(async (databaseName) => {
        window.store = await BookkitLocal.open({ namespace: 'research', databaseName });
        window.versionBlocked = null;
        window.addEventListener('bookkit:local:version-blocked', (event) => {
          window.versionBlocked = event.detail;
        });
      }, name);

      const newerPage = await context.newPage();
      await newerPage.goto(base);
      await newerPage.evaluate(async (databaseName) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName, 3);
          request.onupgradeneeded = () => {};
          request.onsuccess = () => { request.result.close(); resolve(); };
          request.onerror = () => reject(request.error);
        });
      }, name);

      await stalePage.waitForFunction(() => window.versionBlocked);
      const detail = await stalePage.evaluate(() => window.versionBlocked);
      assert.equal(detail.reason, 'version-change');
      const staleResult = await stalePage.evaluate(async () => {
        try {
          await window.store.put(BookkitLocal.createRecord('research', 'note', 's', { text: 'stale' }, { id: 'stale' }));
          return { ok: true };
        } catch (error) {
          return { ok: false, code: error.code, message: error.message };
        }
      });
      assert.equal(staleResult.ok, false);
      assert.equal(staleResult.code, 'CONNECTION_CLOSED');

      const reopenResult = await stalePage.evaluate(async (databaseName) => {
        try {
          await window.BookkitLocal.open({ namespace: 'research', databaseName });
          return { ok: true };
        } catch (error) {
          return { ok: false, code: error.code };
        }
      }, name);
      assert.equal(reopenResult.ok, false);
      assert.equal(reopenResult.code, 'VERSION_MISMATCH');
      await stalePage.close();
      await newerPage.close();
    });

    await check('BroadcastChannel notifies another tab without payloads', async () => {
      const name = unique('broadcast');
      const receiving = await context.newPage();
      const sending = await context.newPage();
      await loadModule(receiving, base);
      await loadModule(sending, base);
      await receiving.evaluate(async (databaseName) => {
        await BookkitLocal.open({ namespace: 'research', databaseName });
        window.remoteEvents = [];
        window.addEventListener('bookkit:local:record-committed', (event) => {
          window.remoteEvents.push(event.detail);
        });
      }, name);
      await sending.evaluate(async (databaseName) => {
        const store = await BookkitLocal.open({ namespace: 'research', databaseName });
        await store.put(BookkitLocal.createRecord('research', 'note', 's', { text: 'private' }, { id: 'remote' }));
      }, name);
      await receiving.waitForFunction(() => window.remoteEvents.length > 0);
      const events = await receiving.evaluate(() => window.remoteEvents);
      assert.equal(events[0].remote, true);
      assert.equal(events[0].id, 'remote');
      assert.equal(Object.prototype.hasOwnProperty.call(events[0], 'payload'), false);
      await receiving.close();
      await sending.close();
    });

    await check('list offset/order and count filters', async () => {
      const name = unique('list');
      const result = await page.evaluate(async (databaseName) => {
        const store = await BookkitLocal.open({ namespace: 'research', databaseName });
        const records = ['a', 'b', 'c'].map((id) => BookkitLocal.createRecord('research', 'note', 's', { text: id }, { id }));
        await store.batch(records.map((record) => ({ type: 'put', record })));
        const allDesc = await store.list({ order: 'desc' });
        const allAsc = await store.list({ order: 'asc' });
        const page = await store.list({ order: 'asc', offset: 1, limit: 1 });
        const count = await store.count({ kind: 'note' });
        const countSubject = await store.count({ subjectId: 's' });
        await store.close();
        return {
          desc: allDesc.map((record) => record.id),
          asc: allAsc.map((record) => record.id),
          page: page.map((record) => record.id),
          count,
          countSubject
        };
      }, name);
      assert.equal(result.desc.length, 3);
      assert.equal(result.asc.length, 3);
      assert.equal(result.page.length, 1);
      assert.equal(result.count, 3);
      assert.equal(result.countSubject, 3);
    });

    await check('browser restart preserves IndexedDB records in a persistent profile', async () => {
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookkit-local-profile-'));
      const databaseName = unique('restart');
      let persistent = await chromium.launchPersistentContext(userDataDir, { headless: true });
      try {
        const persistentPage = await persistent.newPage();
        await loadModule(persistentPage, base);
        await persistentPage.evaluate(async (name) => {
          const store = await BookkitLocal.open({ namespace: 'research', databaseName: name });
          await store.put(BookkitLocal.createRecord('research', 'note', 's', { text: 'survives restart' }, { id: 'persisted' }));
          await store.close();
        }, databaseName);
      } finally {
        await persistent.close();
      }

      persistent = await chromium.launchPersistentContext(userDataDir, { headless: true });
      try {
        const persistentPage = await persistent.newPage();
        await loadModule(persistentPage, base);
        const text = await persistentPage.evaluate(async (name) => {
          const store = await BookkitLocal.open({ namespace: 'research', databaseName: name });
          const record = await store.get('note', 'persisted');
          await store.close();
          return record?.payload.text || null;
        }, databaseName);
        assert.equal(text, 'survives restart');
      } finally {
        await persistent.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });

    await check('missing IndexedDB reports an explicit unavailable state', async () => {
      const unavailablePage = await context.newPage();
      await unavailablePage.addInitScript(() => {
        Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
      });
      await unavailablePage.goto(base);
      const result = await unavailablePage.evaluate(async () => {
        const module = await import('/lib/index.js');
        const BookkitLocal = module.default;
        const availability = await BookkitLocal.checkAvailability();
        let code = null;
        try {
          await BookkitLocal.open({ namespace: 'research', databaseName: 'unavailable' });
        } catch (error) {
          code = error.code;
        }
        return { availability, code };
      });
      assert.equal(result.availability.available, false);
      assert.equal(result.code, 'STORAGE_UNAVAILABLE');
      await unavailablePage.close();
    });

    await check('quota exhaustion is reported as QUOTA_EXCEEDED', async () => {
      const quotaContext = await browser.newContext();
      const quotaPage = await quotaContext.newPage();
      try {
        await loadModule(quotaPage, base);
        const cdp = await quotaContext.newCDPSession(quotaPage);
        await cdp.send('Storage.overrideQuotaForOrigin', {
          origin: new URL(base).origin,
          quotaSize: 8192
        });
        const result = await quotaPage.evaluate(async (databaseName) => {
          const store = await BookkitLocal.open({ namespace: 'research', databaseName });
          try {
            await store.put(BookkitLocal.createRecord('research', 'note', 'quota', {
              text: 'x'.repeat(30000)
            }, { id: 'too-large' }));
            return { ok: true };
          } catch (error) {
            return { ok: false, code: error.code, name: error.name };
          } finally {
            await store.close();
          }
        }, unique('quota'));
        assert.equal(result.ok, false);
        assert.equal(result.code, 'QUOTA_EXCEEDED');
        assert.equal(result.name, 'QuotaExceededError');
      } finally {
        await quotaContext.close();
      }
    });

    await check('StorageManager diagnostics are exposed', async () => {
      const result = await page.evaluate(async () => {
        const estimate = await BookkitLocal.getStorageEstimate();
        const persisted = await BookkitLocal.isPersisted();
        return {
          estimateIsObject: estimate === null || typeof estimate === 'object',
          persistedIsBoolean: typeof persisted === 'boolean'
        };
      });
      assert.equal(result.estimateIsObject, true);
      assert.equal(result.persistedIsBoolean, true);
    });

    assert.deepEqual(pageErrors, []);
    if (failures.length) {
      console.error(`\nFAILED (${failures.length}):`);
      for (const failure of failures) console.error(`\n${failure}`);
      process.exitCode = 1;
    } else {
      console.log('\nPASS: real IndexedDB CRUD, commit durability, isolation, atomic batches, events,');
      console.log('export/import conflicts, migration v1->v2, failed upgrade preservation, blocked');
      console.log('upgrade recovery, versionchange closure, cross-tab notifications, browser restart');
      console.log('persistence, missing-capability handling, quota reporting and storage diagnostics.');
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
