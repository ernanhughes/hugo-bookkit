/* Bookkit reference previews: progressive enhancement only.
 *
 * Preview content is static markup rendered at build time, so links and full
 * documents work without JavaScript. This script only adds: Escape dismissal,
 * touch toggling, and viewport-edge clamping. It never injects HTML content;
 * it only toggles attributes and classes on server-rendered elements.
 */
(function () {
  "use strict";

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  function closestWrap(element) {
    var node = element;
    while (node) {
      if (node.classList && node.classList.contains("bookkit-ref-wrap")) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function closeWrap(wrap, returnFocus) {
    if (!wrap) {
      return;
    }
    wrap.setAttribute("data-dismissed", "true");
    wrap.removeAttribute("data-open");
    var toggle = wrap.querySelector("[data-bookkit-ref-toggle]");
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
    }
    if (returnFocus) {
      var link = wrap.querySelector("a.bookkit-ref");
      if (link && document.activeElement && closestWrap(document.activeElement) === wrap) {
        link.focus();
      }
    }
  }

  function reopenAllowed(wrap) {
    wrap.removeAttribute("data-dismissed");
  }

  function clampToViewport(wrap) {
    var preview = wrap.querySelector("[data-bookkit-ref-preview]");
    if (!preview) {
      return;
    }
    wrap.classList.remove("bookkit-ref-preview--align-right");
    try {
      var rect = preview.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        wrap.classList.add("bookkit-ref-preview--align-right");
      }
    } catch (error) {
      return;
    }
  }

  each(document.querySelectorAll(".bookkit-ref-wrap"), function (wrap) {
    var link = wrap.querySelector("a.bookkit-ref");
    var toggle = wrap.querySelector("[data-bookkit-ref-toggle]");
    var preview = wrap.querySelector("[data-bookkit-ref-preview]");
    if (!link || !toggle || !preview) {
      return;
    }

    link.addEventListener("mouseenter", function () {
      reopenAllowed(wrap);
      clampToViewport(wrap);
    });
    link.addEventListener("focus", function () {
      reopenAllowed(wrap);
      clampToViewport(wrap);
    });
    wrap.addEventListener("mouseleave", function () {
      closeWrap(wrap, false);
    });
    wrap.addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.key === "Esc") {
        event.stopPropagation();
        closeWrap(wrap, true);
      }
    });
    toggle.addEventListener("click", function (event) {
      event.preventDefault();
      if (wrap.getAttribute("data-open") === "true") {
        closeWrap(wrap, false);
      } else {
        reopenAllowed(wrap);
        wrap.setAttribute("data-open", "true");
        toggle.setAttribute("aria-expanded", "true");
        clampToViewport(wrap);
      }
    });
  });

  document.addEventListener("click", function (event) {
    each(document.querySelectorAll('.bookkit-ref-wrap[data-open="true"]'), function (wrap) {
      if (!wrap.contains(event.target)) {
        closeWrap(wrap, false);
      }
    });
  });
})();
