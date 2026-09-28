/* Bookkit Research (R21B): optional research live-state and trusted refresh.
 *
 * Static R19 content always renders first; this script only enhances.
 * - GET updates the card when the API reports a different run.
 * - POST refresh is rendered only when the site enables it
 *   (params.research.refresh_ui + api_base) and always uses mode=auto.
 * No research logic lives here: states, counts, and relations come
 * verbatim from the R20 dossier. textContent only; no innerHTML. */
(() => {
  'use strict';

  const asString = (value) => (value == null ? '' : String(value));

  const apiHost = document.querySelector('[data-api-base]');
  const apiBase = apiHost ? asString(apiHost.getAttribute('data-api-base')) : '';
  if (!apiBase) return;

  const card = document.querySelector('[data-research-card]');
  const liveNote = document.querySelector('[data-research-live]');
  const refreshBlock = document.querySelector('[data-research-refresh]');
  const say = (message) => {
    if (!liveNote) return;
    liveNote.hidden = false;
    liveNote.textContent = message;
  };

  const endpoint = (book, chapter, suffix) => {
    const base = apiBase.replace(/\/+$/, '');
    const clean = (part) => encodeURIComponent(asString(part)).replace(/%2F/g, '');
    return `${base}/api/research/chapters/${clean(book)}/${clean(chapter)}${suffix || ''}`;
  };

  // Live-state enhancement: replace card state/counts only when the API
  // reports a different run than the statically rendered one.
  const enhanceFromApi = async () => {
    if (!card) return;
    const book = card.getAttribute('data-research-book');
    const chapter = card.getAttribute('data-research-chapter');
    const staticRun = card.getAttribute('data-research-run');
    if (!book || !chapter) return;
    let response;
    try {
      response = await fetch(endpoint(book, chapter), { headers: { Accept: 'application/json' } });
    } catch (error) {
      say('Live research status unavailable.');
      return;
    }
    if (!response.ok) {
      say('Live research status unavailable.');
      return;
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      return;
    }
    const dossier = (body && body.dossier) || null;
    const research = (dossier && dossier.research) || {};
    if (!dossier || !research.run_id || research.run_id === staticRun) return;
    const stateText = card.querySelector('[data-research-state-text]');
    if (stateText) stateText.textContent = asString(research.state) || stateText.textContent;
    const counts = card.querySelector('[data-research-counts]');
    const summary = dossier.summary || {};
    if (counts && typeof summary.sources === 'number') {
      counts.textContent =
        `${summary.sources} sources · ` +
        `${summary.evidence_relations || 0} evidence relationships · ` +
        `${summary.open_gaps || 0} open gaps`;
    }
    card.setAttribute('data-research-state', asString(research.state));
    card.setAttribute('data-research-run', asString(research.run_id));
  };

  // Trusted refresh (rendered only when explicitly enabled server-side).
  const button = refreshBlock
    ? refreshBlock.querySelector('[data-research-refresh-button]')
    : null;
  const status = refreshBlock
    ? refreshBlock.querySelector('[data-research-refresh-status]')
    : null;

  const setBusy = (busy, message) => {
    if (!button) return;
    if (busy) button.setAttribute('disabled', '');
    else button.removeAttribute('disabled');
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (status && message !== undefined) status.textContent = message;
  };

  const announce = (message) => {
    if (status) status.textContent = message;
    else say(message);
  };

  const refresh = async () => {
    if (!button || !refreshBlock) return;
    const book = refreshBlock.getAttribute('data-research-book');
    const chapter = refreshBlock.getAttribute('data-research-chapter');
    if (!book || !chapter) return;
    setBusy(true, 'Researching this chapter…');
    let response;
    try {
      response = await fetch(endpoint(book, chapter, '/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ mode: 'auto' }),
      });
    } catch (error) {
      setBusy(false, 'Research refresh did not complete. The previous research remains available.');
      return;
    }
    if (response.status === 409) {
      setBusy(false, 'A research refresh is already in progress.');
      return;
    }
    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }
    if (!response.ok || !body || body.ok !== true) {
      setBusy(false, 'Research refresh did not complete. The previous research remains available.');
      return;
    }
    if (body.action === 'REUSED') {
      setBusy(false, 'Research is already current.');
      return;
    }
    const delta = (body.dossier && body.dossier.delta) || null;
    if (delta) {
      setBusy(
        false,
        `Research updated: ${delta.relations_reused || 0} relationships reused, ` +
        `${delta.relations_revalidated || 0} re-evaluated. Reload to view the updated research.`,
      );
    } else {
      setBusy(false, 'Research complete. Reload to view the updated research.');
    }
  };

  if (button) {
    refreshBlock.hidden = false;
    button.addEventListener('click', () => {
      if (button.hasAttribute('disabled')) return;
      refresh();
    });
  }

  if (card) {
    enhanceFromApi();
  }
})();
