// Release migration test: create real data with the frozen v0.4.2 runtime,
// then open the same database with the current schema-v2 implementation.
//
// Run: node tests/upgrade-v0.4.2.browser.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OLD = path.join(__dirname, 'fixtures/bookkit-v0.4.2');
const NEW = path.join(ROOT, 'static/js/bookkit-local');

function serve() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/index.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><meta charset="utf-8"><title>v0.4.2 upgrade test</title>');
      return;
    }

    const match = url.pathname.match(/^\/(old|new)\/([a-z0-9.-]+\.js)$/i);
    if (!match) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    const root = match[1] === 'old' ? OLD : NEW;
    const file = path.join(root, match[2]);
    if (!fs.existsSync(file)) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    response.end(fs.readFileSync(file));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base);
    await page.evaluate(async () => {
      window.OldModule = await import('/old/index.js');
      window.NewModule = await import('/new/index.js');
    });

    const databaseName = unique('v042-upgrade');
    const result = await page.evaluate(async (name) => {
      const Old = window.OldModule;
      const oldStore = await Old.default.open({ namespace: 'research', databaseName: name });
      const note = await oldStore.put(Old.createRecord(
        'research', 'note', 'retrieval-07-chapter',
        { text: 'Saved by the v0.4.2 runtime', url: 'https://example.org/old' },
        { id: 'v042-note' }
      ));
      const source = await oldStore.put(Old.createRecord(
        'research', 'source', 'retrieval-07-chapter',
        { title: 'Old source', url: 'https://example.org/source', readingStatus: 'read' },
        { id: 'v042-source' }
      ));
      await oldStore.close();

      const before = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => {
          const db = request.result;
          const version = db.version;
          const tx = db.transaction('records', 'readonly');
          const count = tx.objectStore('records').count();
          count.onsuccess = () => {
            const result = { version, count: count.result };
            db.close();
            resolve(result);
          };
          count.onerror = () => reject(count.error);
        };
        request.onerror = () => reject(request.error);
      });

      const New = window.NewModule;
      const newStore = await New.default.open({ namespace: 'research', databaseName: name });
      const migratedNote = await newStore.get('note', 'v042-note');
      const migratedSource = await newStore.get('source', 'v042-source');
      const schemaVersion = newStore.schemaVersion;
      await newStore.put(New.default.createRecord(
        'research', 'note', 'retrieval-07-chapter',
        { text: 'Added after the v2 upgrade' },
        { id: 'v2-note' }
      ));
      const notesAfter = await newStore.list({ kind: 'note' });
      await newStore.close();

      const after = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('records', 'readonly');
          const store = tx.objectStore('records');
          const indexes = Array.from(store.indexNames);
          const count = store.count();
          count.onsuccess = () => {
            const result = { version: db.version, count: count.result, indexes };
            db.close();
            resolve(result);
          };
          count.onerror = () => reject(count.error);
        };
        request.onerror = () => reject(request.error);
      });

      let downgrade = null;
      await new Promise((resolve) => {
        const request = indexedDB.open(name, 1);
        request.onerror = () => {
          downgrade = request.error?.name || 'error';
          resolve();
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });

      return {
        before,
        after,
        downgrade,
        schemaVersion,
        noteText: migratedNote?.payload?.text,
        noteUrl: migratedNote?.payload?.url,
        noteRevision: migratedNote?.revision,
        noteCreatedAt: migratedNote?.createdAt,
        sourceTitle: migratedSource?.payload?.title,
        sourceRevision: migratedSource?.revision,
        notesAfter: notesAfter.map((record) => record.id).sort(),
        oldRevision: note.revision,
        oldSourceRevision: source.revision
      };
    }, databaseName);

    assert.equal(result.before.version, 1);
    assert.equal(result.before.count, 2);
    assert.equal(result.after.version, 2);
    assert.equal(result.after.count, 3);
    assert.ok(result.after.indexes.includes('byNamespaceKindUpdatedAt'));
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.noteText, 'Saved by the v0.4.2 runtime');
    assert.equal(result.noteUrl, 'https://example.org/old');
    assert.equal(result.noteRevision, result.oldRevision);
    assert.ok(result.noteCreatedAt);
    assert.equal(result.sourceTitle, 'Old source');
    assert.equal(result.sourceRevision, result.oldSourceRevision);
    assert.deepEqual(result.notesAfter, ['v042-note', 'v2-note']);
    assert.equal(result.downgrade, 'VersionError');

    // A v0.4.2 tab holding the connection must not block the v2 upgrade: its
    // versionchange handler closes the database. The stale store must then fail
    // closed rather than write with the old connection.
    const liveName = unique('v042-live-upgrade');
    const live = await page.evaluate(async (name) => {
      const Old = window.OldModule;
      const New = window.NewModule;
      const oldStore = await Old.default.open({ namespace: 'research', databaseName: name });
      await oldStore.put(Old.createRecord(
        'research', 'note', 'subject', { text: 'before upgrade' }, { id: 'live-note' }
      ));

      const events = [];
      for (const type of ['bookkit:local:version-change', 'bookkit:local:version-blocked']) {
        window.addEventListener(type, (event) => {
          events.push({ type, detail: event.detail });
        });
      }

      const newStore = await New.default.open({ namespace: 'research', databaseName: name });
      const migrated = await newStore.get('note', 'live-note');

      let staleWrite = null;
      try {
        await oldStore.put(Old.createRecord(
          'research', 'note', 'subject', { text: 'stale write' }, { id: 'stale-write' }
        ));
      } catch (error) {
        staleWrite = error?.name || 'rejected';
      }
      const staleRecord = await newStore.get('note', 'stale-write');
      await newStore.close();
      return {
        schemaVersion: newStore.schemaVersion,
        migrated: migrated?.payload?.text,
        staleWrite,
        staleRecord,
        events
      };
    }, liveName);

    assert.equal(live.schemaVersion, 2);
    assert.equal(live.migrated, 'before upgrade');
    assert.notEqual(live.staleWrite, null);
    assert.equal(live.staleRecord, null);
    assert.ok(live.events.some((event) => event.type === 'bookkit:local:version-change'
      || event.detail?.reason === 'version-change'));

    assert.deepEqual(errors, []);
    console.log('v0.4.2 -> v2 upgrade: records preserved, new writes and index present, downgrade rejected,');
    console.log('live v0.4.2 connection closed on versionchange, stale writes rejected, no UI payloads leaked.');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
