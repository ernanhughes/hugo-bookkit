(function () {
  "use strict";

  function getStorage() {
    try {
      var probe = "hugo-bookkit:storage-probe";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function normalizePath(value) {
    try {
      var pathname = new URL(value, window.location.origin).pathname;
      return pathname.replace(/\/+$/, "") || "/";
    } catch (error) {
      return "";
    }
  }

  var storage = getStorage();
  if (!storage) {
    return;
  }

  document.querySelectorAll("[data-book-reader]").forEach(function (reader) {
    if (reader.dataset.progressEnabled !== "true") {
      return;
    }

    var bookSlug = reader.dataset.bookSlug;
    if (!bookSlug) {
      return;
    }

    var storagePrefix = reader.dataset.storagePrefix || "hugo-bookkit:progress:";
    var key = storagePrefix + bookSlug;
    var chapterLinks = Array.prototype.slice.call(reader.querySelectorAll("[data-chapter-url]"));
    var currentUrl = reader.dataset.currentUrl;

    if (currentUrl) {
      var currentLink = chapterLinks.find(function (link) {
        return normalizePath(link.dataset.chapterUrl) === normalizePath(currentUrl);
      });

      var progress = {
        url: currentUrl,
        title: reader.dataset.currentTitle || (currentLink && currentLink.dataset.chapterTitle) || "",
        number: reader.dataset.currentNumber || (currentLink && currentLink.dataset.chapterNumber) || "",
        position: Number(reader.dataset.currentPosition || (currentLink && currentLink.dataset.chapterPosition) || 0),
        updatedAt: Date.now()
      };

      try {
        storage.setItem(key, JSON.stringify(progress));
      } catch (error) {
        return;
      }
      return;
    }

    var saved;
    try {
      saved = JSON.parse(storage.getItem(key) || "null");
    } catch (error) {
      saved = null;
    }

    if (!saved || !saved.url) {
      return;
    }

    var savedPath = normalizePath(saved.url);
    var savedLink = chapterLinks.find(function (link) {
      return normalizePath(link.dataset.chapterUrl) === savedPath;
    });

    if (!savedLink) {
      try {
        storage.removeItem(key);
      } catch (error) {
        // Stale progress is harmless; the default Chapter 1 state remains.
      }
      return;
    }

    savedLink.classList.add("is-last-read");

    var resume = reader.querySelector("[data-book-resume]");
    var resumeLink = reader.querySelector("[data-book-resume-link]");
    var kicker = reader.querySelector("[data-book-resume-kicker]");
    var title = reader.querySelector("[data-book-resume-title]");
    var action = reader.querySelector("[data-book-resume-action]");

    if (!resume || !resumeLink || !kicker || !title || !action) {
      return;
    }

    var chapterNumber = savedLink.dataset.chapterNumber || saved.number || "";
    resume.classList.add("has-progress");
    resumeLink.href = savedLink.href;
    kicker.textContent = "Continue reading";
    title.textContent = savedLink.dataset.chapterTitle || saved.title || "Continue reading";
    action.textContent = chapterNumber ? "Continue Chapter " + chapterNumber + " →" : "Continue reading →";
  });
})();
