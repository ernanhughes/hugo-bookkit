import BookkitLocal from '/js/bookkit-local/index.js';

const note = document.querySelector('[data-local-data-demo-note]');
const status = document.querySelector('[data-local-data-demo-status]');
let store = null;
let revision = 0;
let timer = null;

function setStatus(text) {
  if (status) status.textContent = text;
}

async function save() {
  if (!store || !note) return;
  setStatus('Saving…');
  try {
    const saved = await store.put({
      kind: 'demo-note',
      id: 'demo-note',
      subjectId: 'bookkit-example',
      schemaVersion: 1,
      payload: { text: note.value }
    }, { expectedRevision: revision });
    revision = saved.revision;
    setStatus(`Saved locally at ${new Date(saved.updatedAt).toLocaleTimeString()}. Reload the page to confirm persistence.`);
  } catch (error) {
    setStatus(`Save failed: ${error.message}. This demonstration does not fall back to memory storage.`);
  }
}

async function start() {
  if (!note) return;
  try {
    const availability = await BookkitLocal.checkAvailability();
    if (!availability.available) {
      setStatus(`Local storage unavailable: ${availability.reason}`);
      note.disabled = true;
      return;
    }
    store = await BookkitLocal.open({ namespace: 'demo' });
    const existing = await store.get('demo-note', 'demo-note');
    if (existing) {
      note.value = existing.payload?.text || '';
      revision = existing.revision;
      setStatus(`Loaded from this browser at ${new Date(existing.updatedAt).toLocaleTimeString()}.`);
    } else {
      setStatus('No saved note yet. Start typing; this demo saves after you pause.');
    }
    note.addEventListener('input', () => {
      setStatus('Unsaved changes…');
      clearTimeout(timer);
      timer = setTimeout(save, 500);
    });
  } catch (error) {
    setStatus(`Local storage could not open: ${error.message}`);
    note.disabled = true;
  }
}

start();
