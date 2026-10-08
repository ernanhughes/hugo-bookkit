(() => {
  const init = () => {
    const copy = async (button, text, status, fallback) => {
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = 'Copied.';
      } catch (_) {
        fallback.hidden = false;
        fallback.removeAttribute('aria-hidden');
        fallback.focus();
        fallback.select();
        status.textContent = 'Clipboard unavailable. Select and copy the text manually.';
      }
    };
    document.querySelectorAll('[data-example-code]').forEach(block => {
      const button = block.querySelector('[data-example-copy]');
      const source = block.querySelector('[data-example-source]');
      button.hidden = false;
      button.addEventListener('click', () => copy(button, source.value, block.querySelector('[role=status]'), source));
    });
    document.querySelectorAll('[data-example-copy-prompt]').forEach(button => {
      button.hidden = false;
      button.addEventListener('click', () => copy(button, button.parentElement.querySelector('textarea').value,
        button.parentElement.querySelector('[role=status]'), button.parentElement.querySelector('textarea')));
    });
    document.querySelectorAll('[data-bookkit-example]').forEach(details => {
      const summary = details.querySelector('summary');
      const close = details.querySelector('[data-example-close]');
      close.hidden = false;
      const collapse = () => { details.open = false; summary.focus(); };
      close.addEventListener('click', collapse);
      details.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); collapse(); }
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
