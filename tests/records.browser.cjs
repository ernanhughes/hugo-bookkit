// Run: node tests/records.browser.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><title>Record storage regression</title>');
    }
    const name = path.basename(req.url);
    const file = path.join(__dirname, '../static/js/bookkit-local', name);
    if (!name.endsWith('.js') || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader('Content-Type', 'text/javascript');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
      const { default: BookkitLocal, createRecord } = await import('/index.js');
      const store = await BookkitLocal.open({ namespace: 'research', databaseName: 'records-regression' });
      const events = [];
      for (const type of ['record-committed', 'record-deleted']) {
        window.addEventListener(`bookkit:local:${type}`, event => events.push(event.detail));
      }
      const note = createRecord('research', 'note', 'chapter-1', { text: 'Saved research' }, { id: 'note-1' });
      await store.put(note);
      await store.batch([
        { type: 'put', record: { ...note, payload: { text: 'Updated research' } } },
        { type: 'put', record: createRecord('research', 'source', 'chapter-1', { url: 'https://example.org' }, { id: 'source-1' }) },
        { type: 'put', record: createRecord('research', 'note', 'chapter-1', { text: 'Temporary' }, { id: 'temporary' }) },
        { type: 'delete', kind: 'note', id: 'temporary' }
      ]);
      const saved = await store.get('note', 'note-1');
      const limited = await Promise.race([
        store.list({ subjectId: 'chapter-1', limit: 1 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Limited query never resolved')), 3000))
      ]);
      const zero = await store.list({ limit: 0 });
      await store.batch([]);
      const beforeFailure = events.length;
      let rejected = false;
      try {
        await store.batch([
          { type: 'put', record: { ...note, id: 'rollback' } },
          { type: 'put', record: { ...note, id: 'invalid', payload: { uncloneable() {} } } }
        ]);
      } catch { rejected = true; }
      const rolledBack = await store.get('note', 'rollback');
      const failedEvents = events.length - beforeFailure;
      // Exercise namespace overrides and ordering for repeated keys in a batch.
      await store.batch([
        { type: 'put', namespace: 'other', record: note },
        { type: 'put', namespace: 'other', record: note }
      ]);
      const { openStore, getRecord } = await import('/records.js');
      const other = await openStore({ namespace: 'other', databaseName: 'records-regression' });
      const otherNote = await getRecord(other, 'note', note.id);
      other.close();
      await store.close();
      return {
        text: saved.payload.text, revision: saved.revision,
        limited: limited.length, zero: zero.length, rejected,
        rolledBack, failedEvents, otherRevision: otherNote.revision,
        otherNamespace: otherNote.namespace
      };
    });
    assert.deepEqual(result, {
      text: 'Updated research', revision: 2, limited: 1, zero: 0,
      rejected: true, rolledBack: null, failedEvents: 0,
      otherRevision: 2, otherNamespace: 'other'
    });
    await page.reload();
    const persisted = await page.evaluate(async () => {
      const { default: BookkitLocal } = await import('/index.js');
      const store = await BookkitLocal.open({ namespace: 'research', databaseName: 'records-regression' });
      const notes = await store.list({ kind: 'note', subjectId: 'chapter-1' });
      const count = await store.count({ subjectId: 'chapter-1' });
      await store.delete('note', 'note-1');
      return { texts: notes.map(note => note.payload.text), count, deleted: await store.get('note', 'note-1') };
    });
    assert.deepEqual(persisted, { texts: ['Updated research'], count: 2, deleted: null });
    assert.deepEqual(errors, []);
    console.log('Research storage: module loading, saves, reloads, queries, atomic batches, rollback and namespace isolation passed.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
